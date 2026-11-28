/**
 * 模型接力纯领域逻辑的契约测试（docs/fen-jue/model-relay.md）。
 */

import { describe, expect, it } from "vitest";
import {
  isQuotaExhaustedFailure,
  modelRelayChainSchema,
  QUOTA_EXHAUSTED_CODES,
  readFiveHourUsedPercent,
  resolveRelayTarget,
  type ModelRelayEntry,
  type RelayUsage,
} from "@zcode/shared";
import type { UsageQuotaLimit } from "@zcode/shared";

const entry = (providerId: string, modelId: string, thresholdPercent: number): ModelRelayEntry => ({
  providerId,
  modelId,
  thresholdPercent,
});
const known = (usedPercent: number): RelayUsage => ({ known: true, usedPercent });
const unknown: RelayUsage = { known: false };
const usageFrom =
  (percents: Record<string, number | null>) =>
  (e: ModelRelayEntry): RelayUsage => {
    const value = percents[`${e.providerId}/${e.modelId}`];
    return value === undefined || value === null ? unknown : known(value);
  };
const limit = (overrides: Partial<UsageQuotaLimit>): UsageQuotaLimit => ({
  type: "TOKENS_LIMIT",
  usageDetails: [],
  ...overrides,
});

describe("modelRelayChainSchema", () => {
  it("接受合法链路并拒绝重复模型", () => {
    const chain = { entries: [entry("a", "m1", 80), entry("b", "m2", 90)] };
    expect(modelRelayChainSchema.parse(chain)).toEqual(chain);
    expect(() =>
      modelRelayChainSchema.parse({ entries: [entry("a", "m1", 80), entry("a", "m1", 90)] }),
    ).toThrow();
    expect(() => modelRelayChainSchema.parse({ entries: [entry("a", "m1", 101)] })).toThrow();
    expect(() => modelRelayChainSchema.parse({ entries: [] })).not.toThrow();
  });
});

describe("pickFiveHourLimit / readFiveHourUsedPercent", () => {
  it("GLM 系按 TIME_LIMIT 识别套餐级 5 小时桶", () => {
    const limits = [
      limit({ type: "MODEL_LIMIT", percentage: 10 }),
      limit({ type: "TIME_LIMIT", percentage: 42.5, number: 5, unit: 1 }),
    ];
    expect(readFiveHourUsedPercent(limits)).toBe(42.5);
  });

  it("MiniMax 按 TOKENS_LIMIT + unit=3 + number=5 识别，unit=6 的周窗口不命中", () => {
    const limits = [
      limit({ type: "TOKENS_LIMIT", unit: 6, number: 7, percentage: 5 }),
      limit({ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 66 }),
    ];
    expect(readFiveHourUsedPercent(limits)).toBe(66);
    expect(
      readFiveHourUsedPercent([limit({ type: "TOKENS_LIMIT", unit: 6, number: 7, percentage: 5 })]),
    ).toBeNull();
  });

  it("percentage 缺失或非法时视为未知", () => {
    expect(readFiveHourUsedPercent([limit({ type: "TIME_LIMIT" })])).toBeNull();
    expect(
      readFiveHourUsedPercent([limit({ type: "TIME_LIMIT", percentage: Number.NaN })]),
    ).toBeNull();
    expect(readFiveHourUsedPercent([])).toBeNull();
  });
});

describe("resolveRelayTarget", () => {
  const chain = [
    entry("bigmodel", "GLM-5.4", 80),
    entry("bigmodel", "GLM-5.3", 70),
    entry("minimax", "MiniMax-M3", 90),
  ];

  it("链路少于 2 张或当前模型不在链路内时保持", () => {
    expect(resolveRelayTarget([chain[0]!], chain[0]!, () => known(99))).toEqual({ kind: "keep" });
    expect(resolveRelayTarget(chain, { providerId: "x", modelId: "y" }, () => known(99))).toEqual({
      kind: "keep",
    });
  });

  it("当前模型额度未知或未达阈值时保持", () => {
    expect(resolveRelayTarget(chain, chain[0]!, () => unknown)).toEqual({ kind: "keep" });
    expect(resolveRelayTarget(chain, chain[0]!, usageFrom({ "bigmodel/GLM-5.4": 79.9 }))).toEqual({
      kind: "keep",
    });
    // 已用占比等于阈值视为达到；MiniMax 低于自身阈值，是被选中的接力目标。
    expect(
      resolveRelayTarget(
        chain,
        chain[0]!,
        usageFrom({ "bigmodel/GLM-5.4": 80, "minimax/MiniMax-M3": 10 }),
      ).kind,
    ).toBe("switch");
  });

  it("沿顺序切到第一个低于自身阈值的卡片；环形绕回第一张", () => {
    // 从第一张出发：GLM-5.4(85≥80) → GLM-5.3(72≥70 跳过) → MiniMax(10<90 选中)。
    const usage = usageFrom({
      "bigmodel/GLM-5.4": 85,
      "bigmodel/GLM-5.3": 72,
      "minimax/MiniMax-M3": 10,
    });
    expect(resolveRelayTarget(chain, chain[0]!, usage)).toEqual({
      kind: "switch",
      entry: chain[2],
      usedPercent: 10,
    });
    // 从最后一张出发绕回第一张：MiniMax(92≥90) → GLM-5.4(85<80? 否 85≥80 跳过) → GLM-5.3(65<70 选中)。
    const wrap = usageFrom({
      "bigmodel/GLM-5.4": 85,
      "bigmodel/GLM-5.3": 65,
      "minimax/MiniMax-M3": 92,
    });
    expect(resolveRelayTarget(chain, chain[2]!, wrap)).toEqual({
      kind: "switch",
      entry: chain[1],
      usedPercent: 65,
    });
  });

  it("共享额度桶超额的候选被跳过（即使它自身阈值未到也不满足时按阈值判定）", () => {
    // GLM 两张卡片共享同一套餐桶（同 used=85）；GLM-5.3 阈值 70 ≥ 85 超额跳过。
    const usage = usageFrom({
      "bigmodel/GLM-5.4": 85,
      "bigmodel/GLM-5.3": 85,
      "minimax/MiniMax-M3": 30,
    });
    expect(resolveRelayTarget(chain, chain[0]!, usage)).toEqual({
      kind: "switch",
      entry: chain[2],
      usedPercent: 30,
    });
  });

  it("额度未知的候选视为可用兜底（2026-11-28 产品规则调整）", () => {
    // GLM-5.3 额度未给出（unknown）先于 MiniMax（已知 30%）被选中——环形顺序优先。
    const withUnknown = usageFrom({ "bigmodel/GLM-5.4": 85, "minimax/MiniMax-M3": 30 });
    expect(resolveRelayTarget(chain, chain[0]!, withUnknown)).toEqual({
      kind: "switch",
      entry: chain[1],
    });
    // 已知低额候选环形顺序更靠前时优先选它（行为不变）。
    const knownEarlier = usageFrom({
      "bigmodel/GLM-5.4": 85,
      "bigmodel/GLM-5.3": 60,
      "minimax/MiniMax-M3": 30,
    });
    expect(resolveRelayTarget(chain, chain[0]!, knownEarlier)).toEqual({
      kind: "switch",
      entry: chain[1],
      usedPercent: 60,
    });
    // GLM-5.3 额度未知（按量/查询失败）被视为可用兜底：不跳过、不带 usedPercent。
    // 从 GLM-5.4 出发下一张就是 GLM-5.3，先选中它而不是更后面的 MiniMax。
    const middleUnknown = usageFrom({
      "bigmodel/GLM-5.4": 85,
      "bigmodel/GLM-5.3": null,
      "minimax/MiniMax-M3": 60,
    });
    expect(resolveRelayTarget(chain, chain[0]!, middleUnknown)).toEqual({
      kind: "switch",
      entry: chain[1],
    });

    const allUnknown = usageFrom({
      "bigmodel/GLM-5.4": null,
      "bigmodel/GLM-5.3": null,
      "minimax/MiniMax-M3": null,
    });
    // 当前模型额度未知时不判定、照常发送（规范「不触发的情况」）。
    expect(resolveRelayTarget(chain, chain[0]!, allUnknown)).toEqual({ kind: "keep" });

    // 当前模型已知超额、其余候选额度未知：切到第一个未知额度候选（可用兜底）。
    const currentOverOthersUnknown = usageFrom({
      "bigmodel/GLM-5.4": 85,
      "bigmodel/GLM-5.3": null,
      "minimax/MiniMax-M3": null,
    });
    expect(resolveRelayTarget(chain, chain[0]!, currentOverOthersUnknown)).toEqual({
      kind: "switch",
      entry: chain[1],
    });
  });

  it("一圈内所有候选的已知额度都达阈值且无未知兜底时返回 exhausted", () => {
    const usage = usageFrom({
      "bigmodel/GLM-5.4": 90,
      "bigmodel/GLM-5.3": 80,
      "minimax/MiniMax-M3": 95,
    });
    expect(resolveRelayTarget(chain, chain[1]!, usage)).toEqual({ kind: "exhausted" });
  });
});

describe("isQuotaExhaustedFailure", () => {
  it.each([
    ["1005", ""],
    ["1308", "您的限额将在 2026-12-01 18:50:42 重置"],
    [undefined, "…insufficient_quota…"],
    ["insufficient_quota", ""],
  ])("code=%j message 含额度语义时命中", (code, message) => {
    expect(isQuotaExhaustedFailure(code, message)).toBe(true);
  });

  it.each([
    ["3008", "并发上限"],
    [undefined, "network timeout"],
    [undefined, ""],
  ])("普通限流或无关失败不命中", (code, message) => {
    expect(isQuotaExhaustedFailure(code, message)).toBe(false);
  });

  it("业务码清单与 CLI adapters 的 WORKFLOW_QUOTA_PROVIDER_CODES 同源", async () => {
    // 守护：两个包之间没有依赖，直接读 CLI 源码里的清单块逐项比对；
    // 上游在任一侧增减业务码时，本用例失败提醒同步另一侧。
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      fileURLToPath(
        new URL(
          "../../../apps/zcode-cli/packages/adapters/src/model/workflow-model-failure-policy.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const blockStart = source.indexOf(
      "WORKFLOW_QUOTA_PROVIDER_CODES: ReadonlySet<string> = new Set([",
    );
    const blockEnd = source.indexOf("]);", blockStart);
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const cliCodes = [...source.slice(blockStart, blockEnd).matchAll(/"([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(cliCodes.length).toBeGreaterThan(0);
    expect([...cliCodes].sort()).toEqual([...QUOTA_EXHAUSTED_CODES].sort());
  });
});
