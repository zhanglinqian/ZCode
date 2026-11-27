/* 供应商自带数据的共享查询 hook（额度 / 余额共用）。
 *
 * MiniMax 的套餐额度与 DeepSeek 的账户余额是同一类数据源：都由供应商自己的官方接口
 * 直查，不经过 ZCode 服务端，也不依赖平台登录态。因此共用同一份查询与缓存，
 * 避免两份平行缓存各发一次上游请求。
 */
import { useEffect, useState } from "react";
import type { UsageEntitlementSnapshot } from "@zcode/shared";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

/**
 * 供应商自带数据的轻量查询：直接打 usage-stats RPC，不经过共享 entitlement 缓存，
 * 也不受登录态约束。providerId 或服务实例变化时重查；disabled 时清空。
 *
 * 带模块级 TTL 缓存：设置页的 store 更新会让组件频繁重渲染，effect 依赖里的服务实例
 * 随之变化，无缓存时会对上游每秒发起多次请求（2026-11-26 实测日志）。
 * 30 秒内的重复挂载直接复用上次结果。
 */
const SELF_USAGE_TTL_MS = 30_000;
const selfUsageCache = new Map<
  string,
  { expiresAt: number; snapshot: UsageEntitlementSnapshot | null; error: string | null }
>();

export function useProviderSelfUsageSnapshot(providerId: string, enabled: boolean) {
  const services = useOptionalBaseWorkspaceServices();
  const usageStatsService = services?.usageStatsService;
  const [state, setState] = useState<{
    snapshot: UsageEntitlementSnapshot | null;
    error: string | null;
  }>(() => {
    const cached = selfUsageCache.get(providerId);
    return cached && cached.expiresAt > Date.now()
      ? { snapshot: cached.snapshot, error: cached.error }
      : { snapshot: null, error: null };
  });

  useEffect(() => {
    if (!enabled || !usageStatsService) {
      return;
    }
    let cancelled = false;
    const cached = selfUsageCache.get(providerId);
    if (cached && cached.expiresAt > Date.now()) {
      setState({ snapshot: cached.snapshot, error: cached.error });
      return;
    }
    setState({ snapshot: null, error: null });
    usageStatsService
      .getEntitlementSnapshot({
        preferredProviderId: providerId,
        // 额度/余额属于当前 provider 自己，必须命中它，不能回退到别的供应商。
        requirePreferredProvider: true,
      })
      .then((snapshot) => {
        selfUsageCache.set(providerId, {
          expiresAt: Date.now() + SELF_USAGE_TTL_MS,
          snapshot,
          error: null,
        });
        if (!cancelled) setState({ snapshot, error: null });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        selfUsageCache.set(providerId, {
          expiresAt: Date.now() + SELF_USAGE_TTL_MS,
          snapshot: null,
          error: message,
        });
        if (!cancelled) setState({ snapshot: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, providerId, usageStatsService]);

  return state;
}
