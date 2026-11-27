import { readFile } from "node:fs/promises";
import {
  resolveDefaultReasoningLevel,
  type ModelSelection,
  type PersonalProviderConfigRepository,
} from "@zcode/provider";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";

/** 账本里登记本条迁移用的名字；规则见 docs/fen-jue/behavior-deltas.md D2。 */
export const FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID = "default-reasoning-level-lowest";

/** 与 provider_config.json 同目录的迁移账本文件名。 */
export const FENJUE_MIGRATIONS_FILE_NAME = "fenjue-migrations.json";

export type FenjueDefaultReasoningLevelMigrationResult =
  /** 已保存档位等于旧默认，已改写并记账。 */
  | "applied"
  /** 没有默认选择，或档位不等于旧默认，无需改写，已记账。 */
  | "unchanged"
  /** 账本已有记录，未评估。 */
  | "skipped"
  /** 默认选择对应的模型解析不到：未改写也未记账，下次启动再试。 */
  | "pending";

export interface FenjueDefaultReasoningLevelMigrationOptions {
  /** 个人配置的唯一写入口；迁移不得绕过它另开写路径。 */
  readonly personalRepository: PersonalProviderConfigRepository;
  readonly ledgerFilePath: string;
  /** 用与界面相同的解析取得该选择对应模型当前的档位表；解析不到返回 undefined。 */
  readonly readReasoningLevels: (selection: ModelSelection) => readonly string[] | undefined;
  readonly now?: () => Date;
}

interface FenjueMigrationsLedger {
  readonly schemaVersion: 1;
  readonly applied: Record<string, string>;
}

/**
 * Fen Jue 行为差异 D2：把等于旧默认（最高档）的已保存默认选择一次性改为最低开启档。
 *
 * 账本让迁移只评估一次：迁移后用户手动调回最高档，下次启动不会再被压回去。
 * 个人配置只在 `update` 里写，且在配置锁内重新核对默认选择未被他人改动。
 */
export async function runFenjueDefaultReasoningLevelMigration(
  options: FenjueDefaultReasoningLevelMigrationOptions,
): Promise<FenjueDefaultReasoningLevelMigrationResult> {
  return withFileLock(options.ledgerFilePath, async () => {
    const ledger = await readLedger(options.ledgerFilePath);
    if (ledger.applied[FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID] !== undefined) {
      return "skipped";
    }
    const selection = (await options.personalRepository.read()).defaultModelSelection;
    const savedLevel = selection?.options?.reasoningLevel;
    let result: FenjueDefaultReasoningLevelMigrationResult = "unchanged";
    if (selection && savedLevel !== undefined) {
      const values = options.readReasoningLevels(selection);
      if (!values?.length) return "pending";
      // 只有等于旧默认（最后一项）才迁移；其余档位视为用户显式选择。
      if (savedLevel === values.at(-1)) {
        const reasoningLevel = resolveDefaultReasoningLevel(values) ?? savedLevel;
        let abandoned = false;
        await options.personalRepository.update((current) => {
          const currentSelection = current.defaultModelSelection;
          // 拿到配置锁后默认选择已被其他写入者改动：本轮放弃，下次启动按新值重新评估。
          if (!currentSelection || !isSameSelection(currentSelection, selection)) {
            abandoned = true;
            return current;
          }
          return {
            ...current,
            defaultModelSelection: {
              providerId: currentSelection.providerId,
              modelId: currentSelection.modelId,
              options: { ...currentSelection.options, reasoningLevel },
            },
          };
        });
        if (abandoned) return "pending";
        result = reasoningLevel === savedLevel ? "unchanged" : "applied";
      }
    }
    await writeLedger(
      options.ledgerFilePath,
      ledger,
      FENJUE_DEFAULT_REASONING_LEVEL_MIGRATION_ID,
      options.now?.() ?? new Date(),
    );
    return result;
  });
}

function isSameSelection(
  left: ModelSelection | undefined,
  right: ModelSelection | undefined,
): boolean {
  return (
    left?.providerId === right?.providerId &&
    left?.modelId === right?.modelId &&
    left?.options?.reasoningLevel === right?.options?.reasoningLevel
  );
}

async function readLedger(filePath: string): Promise<FenjueMigrationsLedger> {
  const empty: FenjueMigrationsLedger = { schemaVersion: 1, applied: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    // 文件不存在或内容损坏都按空账本处理：迁移本身幂等且只命中旧默认，最坏情况是多评估一次。
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null) return empty;
  const applied = (parsed as { applied?: unknown }).applied;
  if (typeof applied !== "object" || applied === null || Array.isArray(applied)) return empty;
  const entries = Object.entries(applied).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return { schemaVersion: 1, applied: Object.fromEntries(entries) };
}

async function writeLedger(
  filePath: string,
  ledger: FenjueMigrationsLedger,
  migrationId: string,
  at: Date,
): Promise<void> {
  const next: FenjueMigrationsLedger = {
    schemaVersion: 1,
    applied: { ...ledger.applied, [migrationId]: at.toISOString() },
  };
  await atomicWritePrivateTextFile(filePath, JSON.stringify(next, null, 2));
}
