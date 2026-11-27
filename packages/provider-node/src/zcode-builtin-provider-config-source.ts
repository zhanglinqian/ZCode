import { watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  ModelConfigRules,
  ProviderTemplate,
  ProviderTemplateMap,
  type ModelId,
  type ProviderConfig,
  type ProviderConfigLayerSnapshot,
  type ProviderSource,
} from "@zcode/provider";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import {
  decodeZCodeBuiltinRelease,
  encodeProviderConfigOverrides,
  encodeZCodeBuiltinRelease,
  serializeZCodeBuiltinRelease,
  type ProviderConfigOverrides,
  type ProviderTemplateConfigOverride,
  type ZCodeBuiltinConfigContent,
  type ZCodeBuiltinRelease,
} from "./zcode-builtin-release.js";

export interface NodeZCodeBuiltinProviderConfigSourceOptions {
  readonly bundledFilePath: string;
  readonly activeFilePath?: string;
  readonly watch?: boolean;
}

export type ApplyZCodeBuiltinReleaseResult = "updated" | "unchanged" | "stale";

/** Bundled、Active/LKG 与 Remote 共用同一 Release，并最终发布为现有 Config Snapshot。 */
export class NodeZCodeBuiltinProviderConfigSource implements ProviderSource<ProviderConfigLayerSnapshot> {
  readonly #bundledFilePath: string;
  readonly #activeFilePath: string;
  readonly #sourceKey: string;
  readonly #watchEnabled: boolean;
  readonly #listeners = new Set<(reason: string) => void>();
  #watcher: FSWatcher | null = null;
  #observedSignature: string | null = null;
  #watchRefresh = Promise.resolve();
  #disposed = false;

  constructor(options: NodeZCodeBuiltinProviderConfigSourceOptions) {
    const bundledFilePath = options.bundledFilePath.trim();
    if (!bundledFilePath) throw new Error("ZCode Built-in bundledFilePath 不能为空");
    this.#bundledFilePath = bundledFilePath;
    this.#activeFilePath = options.activeFilePath?.trim() || bundledFilePath;
    // 旧标识只有发布序号，不同 Endpoint 同序号会让 Registry 误复用上一来源。
    // Active 路径已含规范化 Endpoint 隔离范围；Worker 收到同一路径，不另拼账号事实。
    this.#sourceKey = createHash("sha256").update(resolve(this.#activeFilePath)).digest("hex");
    this.#watchEnabled = options.watch !== false;
  }

  get activeFilePath(): string {
    return this.#activeFilePath;
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    this.#assertNotDisposed();
    let release: ZCodeBuiltinRelease;
    try {
      await this.#ensureWatcher();
      release = await withFileLock(this.#activeFilePath, () => this.#readAndMaterializeLocked());
    } catch {
      // Active 只是可丢弃缓存，目录锁、监听或原子物化失败不能阻断
      // Bundled 基线。缓存边界不可用时绕过 Active；Bundled 自身无效仍会在这里抛错。
      const bundled = await readBundledReleaseCandidate(this.#bundledFilePath);
      // 与 #readAndMaterializeLocked 同一不变量：绕过 Active 不等于丢弃专项层，
      // 否则这个分支交出的快照会让 worker 丢思考强度档位与模板里声明的模型。
      release = withPackageOverrides(
        selectReleaseCandidate(bundled, null),
        bundled.release?.config ?? {},
      );
    }
    this.#observedSignature ??= signatureOf(release);
    return snapshotFromRelease(release, this.#sourceKey);
  }

  async applyRemoteRelease(release: ZCodeBuiltinRelease): Promise<ApplyZCodeBuiltinReleaseResult> {
    this.#assertNotDisposed();
    await this.#ensureWatcher();
    const result = await withFileLock(this.#activeFilePath, async () => {
      this.#assertNotDisposed();
      const current = await this.#readAndMaterializeLocked();
      this.#assertNotDisposed();
      // CDN 版本号只决定官方层；远端不能擦除或替换当前安装包声明的两层专项配置。
      release = withPackageOverrides(release, current.config);
      if (release.revision < current.revision) return "stale" as const;
      if (release.revision === current.revision) {
        if (serializeZCodeBuiltinRelease(release) === serializeZCodeBuiltinRelease(current)) {
          return "unchanged" as const;
        }
        throw new Error(`ZCode Built-in 相同 revision ${release.revision} 对应不同内容`);
      }
      await this.#writeActiveLocked(release);
      this.#observedSignature = signatureOf(release);
      return "updated" as const;
    });
    if (result === "updated" && !this.#disposed) this.#emit("remote-updated");
    return result;
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#watcher?.close();
    this.#watcher = null;
    this.#listeners.clear();
  }

  async #readAndMaterializeLocked(): Promise<ZCodeBuiltinRelease> {
    const [bundled, active] = await Promise.all([
      readBundledReleaseCandidate(this.#bundledFilePath),
      this.#activeFilePath === this.#bundledFilePath
        ? Promise.resolve(null)
        : readReleaseCandidate(this.#activeFilePath),
    ]);
    const candidate = selectReleaseCandidate(bundled, active);
    // Bug 原因：Bundled 文件读不到时专项层参数为 undefined，会把 Active 已存的专项层
    // 整块擦掉并降级改写 Active，worker（以 Active 为唯一配置源）随之丢思考强度档位与
    // 模板里声明的模型。区分两种情况：Bundled 可读时仍是权威来源——旧包不带专项层
    // 是刻意声明，不能继承前一安装包的覆盖；仅当 Bundled 不可读时回退选中 release
    // 自带的专项层（即 Active 物化内容）兜底。
    const selected = withPackageOverrides(
      candidate,
      bundled?.release ? bundled.release.config : candidate.config,
    );
    if (this.#activeFilePath !== this.#bundledFilePath) {
      const activeSignature = active?.release ? signatureOf(active.release) : null;
      if (activeSignature !== signatureOf(selected)) await this.#writeActiveLocked(selected);
    }
    return selected;
  }

  async #writeActiveLocked(release: ZCodeBuiltinRelease): Promise<void> {
    this.#assertNotDisposed();
    await atomicWritePrivateTextFile(
      this.#activeFilePath,
      JSON.stringify(encodeZCodeBuiltinRelease(release), null, 2),
    );
  }

  async #ensureWatcher(): Promise<void> {
    await mkdir(dirname(this.#activeFilePath), { recursive: true });
    if (!this.#watchEnabled || this.#watcher || this.#disposed) return;
    const target = basename(this.#activeFilePath);
    this.#watcher = watch(dirname(this.#activeFilePath), (_eventType, fileName) => {
      if (fileName === null || fileName.toString() === target) this.#scheduleWatchRefresh();
    });
    this.#watcher.on("error", () => this.#emit("watch-error"));
  }

  #scheduleWatchRefresh(): void {
    this.#watchRefresh = this.#watchRefresh.then(async () => {
      if (this.#disposed) return;
      try {
        const release = await withFileLock(this.#activeFilePath, () =>
          this.#readAndMaterializeLocked(),
        );
        const signature = signatureOf(release);
        if (this.#disposed || signature === this.#observedSignature) return;
        this.#observedSignature = signature;
        this.#emit("file-changed");
      } catch {
        this.#emit("watch-error");
      }
    });
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("NodeZCodeBuiltinProviderConfigSource 已 dispose");
  }
}

export function createNodeZCodeBuiltinProviderConfigSource(
  options: NodeZCodeBuiltinProviderConfigSourceOptions,
): NodeZCodeBuiltinProviderConfigSource {
  return new NodeZCodeBuiltinProviderConfigSource(options);
}

interface ReleaseCandidate {
  readonly release?: ZCodeBuiltinRelease;
  readonly error?: unknown;
}

/**
 * Bug 原因：远端 Core 只在启动时把构建内嵌的 Bundled 物化到 `runtime/provider/bundled`，
 * 运行中该目录与 Endpoint Active 一起被删除后，每次读取都拿到两个 ENOENT，Provisioning
 * 同步持续失败到 Core 重启。Bundled 在进程生命周期内不可变（升级以退出旧进程为前提），
 * 因此按路径记住本进程最近一次成功解析的 Bundled，仅在文件缺失时作为基线；随后照常由
 * 选中的候选重建 Active。不回写 Bundled 路径：Desktop 的 Bundled 位于只读安装资源内。
 * 用模块级缓存而非实例字段，是因为 Endpoint 切换会新建 Source 实例，也要能读到同一基线。
 * Worker 把 Host 的 Active 当作 Bundled 读取时，这里等价于最近一次成功读取的 LKG。
 */
const lastValidBundledReleaseByPath = new Map<string, ZCodeBuiltinRelease>();

async function readBundledReleaseCandidate(filePath: string): Promise<ReleaseCandidate> {
  const key = resolve(filePath);
  const candidate = await readReleaseCandidate(filePath);
  if (candidate.release) {
    lastValidBundledReleaseByPath.set(key, candidate.release);
    return candidate;
  }
  const baseline = isFileNotFound(candidate.error)
    ? lastValidBundledReleaseByPath.get(key)
    : undefined;
  return baseline ? { release: baseline } : candidate;
}

async function readReleaseCandidate(filePath: string): Promise<ReleaseCandidate> {
  try {
    return { release: decodeZCodeBuiltinRelease(JSON.parse(await readFile(filePath, "utf8"))) };
  } catch (error) {
    // Bug 原因：ENOENT 曾直接返回 null，两份文件都缺失时 AggregateError 的错误列表为空，
    // 日志只剩“均不可用”而没有路径。缺失同样是无效候选，保留原始错误供汇总报告。
    return { error };
  }
}

function selectReleaseCandidate(
  bundled: ReleaseCandidate | null,
  active: ReleaseCandidate | null,
): ZCodeBuiltinRelease {
  if (
    bundled?.release &&
    active?.release &&
    bundled.release.revision === active.release.revision &&
    serializeZCodeBuiltinRelease(bundled.release) !== serializeZCodeBuiltinRelease(active.release)
  ) {
    // 同 revision 冲突属于 Active 缓存失效，不能反向使可信 Bundled 无法启动。
    // 返回 Bundled 后调用方会在能够写入时原子替换 Active。
    return bundled.release;
  }
  const valid = [bundled?.release, active?.release].filter(
    (candidate): candidate is ZCodeBuiltinRelease => candidate !== undefined,
  );
  if (valid.length === 0) {
    throw new AggregateError(
      [bundled?.error, active?.error].filter((error) => error !== undefined),
      "Bundled 与 Active ZCode Built-in Release 均不可用",
    );
  }
  return valid.reduce((newest, candidate) =>
    candidate.revision > newest.revision ? candidate : newest,
  );
}

function snapshotFromRelease(
  release: ZCodeBuiltinRelease,
  sourceKey: string,
): ProviderConfigLayerSnapshot {
  const { modelConfigOverrides, providerConfigOverrides } = release.config;
  const overrideKey =
    modelConfigOverrides || providerConfigOverrides
      ? `:${createHash("sha256")
          .update(
            JSON.stringify([
              modelConfigOverrides ? modelConfigOverrides.toZCodeBuiltinJSON() : null,
              providerConfigOverrides
                ? encodeProviderConfigOverrides(providerConfigOverrides)
                : null,
            ]),
          )
          .digest("hex")}`
      : "";
  return Object.freeze({
    revision: `zcode-builtin:${release.revision}:${sourceKey}${overrideKey}`,
    providers: release.config.providers,
    // 模板专项层同样在构建快照时应用：Active 里的官方列表保持官方原样，
    // 换回不带专项层的包时声明自然消失。
    providerTemplates: applyProviderTemplateOverrides(
      release.config.providerTemplates,
      providerConfigOverrides,
    ),
    // 专项层必须在模板规则之后、Personal 之前应用；不能塞回 modelRules 组内被模板反向覆盖。
    models: modelConfigOverrides
      ? new ModelConfigRules([
          ...release.config.modelConfigRules.rules(),
          ...modelConfigOverrides.rules(),
        ])
      : release.config.modelConfigRules,
  });
}

function applyProviderTemplateOverrides(
  templates: ProviderTemplateMap,
  overrides: ProviderConfigOverrides | undefined,
): ProviderTemplateMap {
  if (!overrides || overrides.templateRules.length === 0) return templates;
  const rulesByTemplate = new Map(overrides.templateRules.map((rule) => [rule.templateId, rule]));
  let changed = false;
  const entries = templates.entries().map((entry) => {
    const rule = rulesByTemplate.get(entry[0]);
    if (!rule) return entry;
    changed = true;
    return [
      entry[0],
      new ProviderTemplate({
        templateId: entry[1].templateId,
        templateNameMap: entry[1].templateNameMap,
        config: insertTemplateModelIds(entry[1].config, rule),
      }),
    ] as const;
  });
  return changed ? new ProviderTemplateMap(entries) : templates;
}

/** 只插入官方列表里没有的 ID，重复应用是幂等的；声明了 modelOrder 的模板同步插入，保持顺序一致。 */
function insertTemplateModelIds(
  config: ProviderConfig,
  rule: ProviderTemplateConfigOverride,
): ProviderConfig {
  const incoming = rule.builtinModelIds.filter(
    (modelId) => !config.builtinModelIds?.includes(modelId),
  );
  if (incoming.length === 0) return config;
  const merge = (existing: readonly ModelId[]): readonly ModelId[] =>
    rule.at === "start"
      ? [...incoming, ...existing.filter((modelId) => !incoming.includes(modelId))]
      : [...existing.filter((modelId) => !incoming.includes(modelId)), ...incoming];
  let next = config.withBuiltinModelIds(
    config.builtinModelIds ? merge(config.builtinModelIds) : incoming,
  );
  return config.modelOrder ? next.withModelOrder(merge(config.modelOrder)) : next;
}

function withPackageOverrides(
  release: ZCodeBuiltinRelease,
  source: Pick<ZCodeBuiltinConfigContent, "modelConfigOverrides" | "providerConfigOverrides">,
): ZCodeBuiltinRelease {
  return {
    ...release,
    config: {
      ...release.config,
      modelConfigOverrides: source.modelConfigOverrides,
      providerConfigOverrides: source.providerConfigOverrides,
    },
  };
}

function signatureOf(release: ZCodeBuiltinRelease): string {
  return `${release.revision}:${serializeZCodeBuiltinRelease(release)}`;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
