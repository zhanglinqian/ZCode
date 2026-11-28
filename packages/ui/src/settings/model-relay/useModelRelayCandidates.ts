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
  /** 该供应商 5 小时窗口的已用占比；与额度一起返回，供对话框直接展示。 */
  readonly usedPercent: number;
}

export interface ModelRelayCandidateGroup {
  readonly providerId: string;
  readonly providerName: string;
  readonly models: readonly ModelRelayCandidateModel[];
}

export interface ModelRelayCandidatesState {
  readonly groups: readonly ModelRelayCandidateGroup[];
  readonly loading: boolean;
  readonly error: string | null;
}

const candidatesCache = new Map<string, { expiresAt: number; state: ModelRelayCandidatesState }>();

/** 读不到额度的供应商归成一组提示，而不是静默消失——用户需要知道为什么列不出模型。 */
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
      (provider) => provider.enabled && provider.executable && provider.models.length > 0,
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
        try {
          const snapshot: UsageEntitlementSnapshot = await usageStatsService.getEntitlementSnapshot(
            {
              preferredProviderId: provider.providerId,
              // 额度属于该 provider 自己，必须命中它，不能回退到别的供应商。
              requirePreferredProvider: true,
            },
          );
          const usedPercent = readFiveHourUsedPercent(snapshot.quota?.limits ?? []);
          if (usedPercent === null) return null;
          return {
            providerId: provider.providerId,
            providerName: provider.providerName ?? provider.providerId,
            models: provider.models.map((model) => ({ modelId: model.modelId, usedPercent })),
          } satisfies ModelRelayCandidateGroup;
        } catch (error) {
          // 单家失败只跳过该供应商；全部失败时由下方汇总 error。
          return { error: error instanceof Error ? error.message : String(error) } as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const groups: ModelRelayCandidateGroup[] = [];
      let failures = 0;
      for (const result of results) {
        if (result === null) continue;
        if ("error" in result) {
          failures += 1;
          continue;
        }
        groups.push(result);
      }
      const next: ModelRelayCandidatesState = {
        groups,
        loading: false,
        error: failures > 0 && groups.length === 0 ? `quota_unavailable:${failures}` : null,
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
