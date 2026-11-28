/**
 * 候选模型查询（添加卡片对话框的数据源）。
 *
 * 遍历供应商设置视图里启用且可执行的供应商，逐家查询额度快照（GLM 走服务端、
 * MiniMax 走官方直连，统一经 getEntitlementSnapshot 的 preferredProviderId 路由），
 * 用 readFiveHourUsedPercent 判定该供应商是否有可识别的 5 小时窗口。
 * 只有读得到 5 小时额度的供应商，其模型才允许加入链路（docs/fen-jue/model-relay.md）。
 *
 * 模块级 30s TTL 缓存与 providerSelfUsageSnapshot 同一理由：设置页 store 更新会让
 * 组件频繁重渲染，无缓存时会对上游每秒发起多次请求。
 */
import { useEffect, useState } from "react";
import {
  readFiveHourUsedPercent,
  type ModelRelayEntry,
  type UsageEntitlementSnapshot,
} from "@zcode/shared";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";

const CANDIDATES_TTL_MS = 30_000;

export interface ModelRelayCandidateModel {
  readonly modelId: string;
  /** 该供应商 5 小时窗口的已用占比；读不到额度（按量付费/查询失败）时缺席。 */
  readonly usedPercent?: number;
}

export interface ModelRelayCandidateGroup {
  readonly providerId: string;
  readonly providerName: string;
  /** 供应商级 5 小时已用占比；读不到额度时缺席（套餐级共享桶，取归一后的首个窗口）。 */
  readonly usedPercent?: number;
  readonly models: readonly ModelRelayCandidateModel[];
}

export interface ModelRelayCandidatesState {
  readonly groups: readonly ModelRelayCandidateGroup[];
  readonly loading: boolean;
  readonly error: string | null;
}

const candidatesCache = new Map<string, { expiresAt: number; state: ModelRelayCandidatesState }>();

/**
 * 候选 = 所有已开启供应商下已开启的模型（2026-11-28 产品规则：不再要求有 5 小时
 * 额度——按量付费、自定义模型都能加入；额度读得到就展示占比，读不到由
 * resolveRelayTarget 把它当可用兜底）。
 */
export function useModelRelayCandidates(enabled: boolean): ModelRelayCandidatesState {
  const services = useOptionalBaseWorkspaceServices();
  const usageStatsService = services?.usageStatsService;
  const { state: providerSettingsState } = useProviderSettingsView();
  const providers =
    providerSettingsState.status === "ready" ? providerSettingsState.view.providers : null;
  const cacheKey = providers
    ? `ready:${providerSettingsState.status === "ready" ? providerSettingsState.view.revision : "none"}`
    : "none";
  const [state, setState] = useState<ModelRelayCandidatesState>(() => {
    const cached = candidatesCache.get(cacheKey);
    return cached && cached.expiresAt > Date.now()
      ? cached.state
      : { groups: [], loading: false, error: null };
  });

  useEffect(() => {
    if (!enabled || !usageStatsService || !providers) return;
    const cached = candidatesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setState(cached.state);
      return;
    }
    let cancelled = false;
    const candidates = providers.filter(
      (provider) =>
        provider.enabled &&
        provider.executable &&
        provider.models.some((model) => model.enabled),
    );
    if (candidates.length === 0) {
      const empty: ModelRelayCandidatesState = {
        groups: [],
        loading: false,
        error: null,
      };
      candidatesCache.set(cacheKey, { expiresAt: Date.now() + CANDIDATES_TTL_MS, state: empty });
      setState(empty);
      return;
    }
    setState({ groups: [], loading: true, error: null });
    Promise.all(
      candidates.map(async (provider) => {
        // 模型级开关：未开启的模型不进候选（产品规则）。
        const enabledModels = provider.models.filter((model) => model.enabled);
        let usedPercent: number | undefined;
        let failed = false;
        try {
          const snapshot: UsageEntitlementSnapshot = await usageStatsService.getEntitlementSnapshot(
            {
              preferredProviderId: provider.providerId,
              // 额度属于该 provider 自己，必须命中它，不能回退到别的供应商。
              requirePreferredProvider: true,
            },
          );
          usedPercent = readFiveHourUsedPercent(snapshot.quota?.limits ?? []) ?? undefined;
        } catch {
          // 额度查询失败不影响候选资格：该组照常列出（展示「无 5 小时额度」）。
          failed = true;
        }
        if (usedPercent === undefined && failed) {
          return {
            providerId: provider.providerId,
            providerName: provider.providerName ?? provider.providerId,
            usedPercent: undefined,
            models: enabledModels.map((model) => ({ modelId: model.modelId })),
          } satisfies ModelRelayCandidateGroup;
        }
        return {
          providerId: provider.providerId,
          providerName: provider.providerName ?? provider.providerId,
          ...(usedPercent === undefined ? {} : { usedPercent }),
          models: enabledModels.map((model) => ({
            modelId: model.modelId,
            ...(usedPercent === undefined ? {} : { usedPercent }),
          })),
        } satisfies ModelRelayCandidateGroup;
      }),
    ).then((results) => {
      if (cancelled) return;
      const groups: ModelRelayCandidateGroup[] = [];
      for (const result of results) {
        groups.push(result);
      }
      const next: ModelRelayCandidatesState = {
        groups,
        loading: false,
        error: null,
      };
      candidatesCache.set(cacheKey, { expiresAt: Date.now() + CANDIDATES_TTL_MS, state: next });
      setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, providers, usageStatsService]);

  return state;
}

/** 已在链路里的模型不再出现在添加列表。 */
export function filterUnaddedCandidates(
  groups: readonly ModelRelayCandidateGroup[],
  entries: readonly ModelRelayEntry[],
): ModelRelayCandidateGroup[] {
  const added = new Set(entries.map((entry) => `${entry.providerId}/${entry.modelId}`));
  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => !added.has(`${group.providerId}/${model.modelId}`)),
    }))
    .filter((group) => group.models.length > 0);
}
