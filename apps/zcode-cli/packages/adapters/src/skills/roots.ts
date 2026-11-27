import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { SkillRoot, SkillSource } from "@zcode/contracts";
import { resolveZCodeDataRootPath } from "@zcode/shared/node";

const GIT_MARKER = ".git";
const HOME_PREFIX = "~/";
const PRIORITY_STEP = 10;
const SKILLS_DIR = "skills";
const ZCODE_DIR = ".zcode";
const AGENTS_DIR = ".agents";

export interface SkillRootResolutionOptions {
  homeDirectory?: string;
  additionalDirectories?: readonly string[];
  extraRoots?: string[];
  extraResolvedRoots?: SkillRoot[];
  includeZcodeSkills?: boolean;
}

export async function resolveDefaultSkillRoots(
  workingDirectory: string,
  options: SkillRootResolutionOptions = {},
): Promise<SkillRoot[]> {
  const resolvedWorkingDirectory = resolve(workingDirectory);
  const roots: SkillRoot[] = [];
  const includeZcode = options.includeZcodeSkills ?? true;
  const home = options.homeDirectory ?? homedir();
  let priority = 0;
  const nextPriority = () => {
    priority += PRIORITY_STEP;
    return priority;
  };

  for (const extraRoot of options.extraRoots ?? []) {
    roots.push(
      root(
        resolveConfiguredRoot(extraRoot, resolvedWorkingDirectory),
        "project",
        "zcode",
        nextPriority(),
      ),
    );
  }

  if (includeZcode) {
    // 用户级技能根有两个 base，不能合并：
    // - `.zcode/skills` 属于 ZCode 数据根，随实例隔离（桌面双实例并行时各读各的）
    // - `.agents/skills` 是跨工具兼容目录（Claude Code 等），必须留在真实家目录，
    //   否则用户从别的工具装的技能在隔离实例里凭空消失
    //
    // homeDirectory 显式注入时优先（调用方与测试用它隔离到临时目录）；
    // 未注入才用数据根解析，否则会绕过注入扫到真实家目录下的技能。
    const zcodeUserSkillsRoot = options.homeDirectory
      ? join(options.homeDirectory, ZCODE_DIR, SKILLS_DIR)
      : resolveZCodeDataRootPath("skills");
    roots.push(
      root(zcodeUserSkillsRoot, "user", "zcode", nextPriority()),
      root(join(home, AGENTS_DIR, SKILLS_DIR), "user", "agents", nextPriority()),
    );
  }

  const projectDirectories = await resolveProjectSkillDirectories(resolvedWorkingDirectory);
  for (const directory of projectDirectories) {
    if (includeZcode) {
      roots.push(...skillRootsForBase(directory, "project", nextPriority));
    }
  }

  for (const directory of new Set(
    (options.additionalDirectories ?? []).map((path) => resolve(path)),
  )) {
    if (directory === resolvedWorkingDirectory) continue;
    roots.push(
      ...skillRootsForBase(directory, "project", nextPriority).map((item) => ({
        ...item,
        namespace: basename(directory),
      })),
    );
  }

  roots.push(...(options.extraResolvedRoots ?? []));

  return roots;
}

async function resolveProjectSkillDirectories(workingDirectory: string): Promise<string[]> {
  const worktreeRoot = await findWorktreeRoot(workingDirectory);
  if (!worktreeRoot) return [workingDirectory];

  const directories: string[] = [];
  let current = workingDirectory;
  while (true) {
    directories.push(current);
    if (current === worktreeRoot || current === dirname(current)) break;
    current = dirname(current);
  }
  return directories;
}

/** 从工作目录向上找最近的 `.git`；项目 skill 根只扫到这一层。 */
export async function findWorktreeRoot(workingDirectory: string): Promise<string | null> {
  let current = workingDirectory;
  while (true) {
    if (await pathExists(join(current, GIT_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function skillRootsForBase(
  baseDirectory: string,
  scope: SkillRoot["scope"],
  nextPriority: () => number,
): SkillRoot[] {
  // 合并而不是 fallback：用户可能同时安装原生 `.zcode` skill 和兼容 `.agents` skill。
  // 同一级别仍保持 `.zcode` 优先，后续同名按 root 顺序解析。
  return [
    root(join(baseDirectory, ZCODE_DIR, SKILLS_DIR), scope, "zcode", nextPriority()),
    root(join(baseDirectory, AGENTS_DIR, SKILLS_DIR), scope, "agents", nextPriority()),
  ];
}

function root(
  path: string,
  scope: SkillRoot["scope"],
  source: SkillSource,
  priority: number,
): SkillRoot {
  return {
    path: resolve(path),
    scope,
    source,
    priority,
  };
}

function resolveConfiguredRoot(path: string, workingDirectory: string): string {
  const expanded = path.startsWith(HOME_PREFIX)
    ? join(homedir(), path.slice(HOME_PREFIX.length))
    : path;
  return isAbsolute(expanded) ? expanded : resolve(workingDirectory, expanded);
}
