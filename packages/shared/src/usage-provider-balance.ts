/**
 * 供应商自带账户余额的纯类型定义。
 *
 * 与 usage-quota.ts 的配额类型是两套语义，不能互相复用：
 * - 配额（quota）有总额与已用，能推导百分比（`UsageQuotaLimit.percentage` 是已用占比）；
 * - 余额（balance）是账户里的货币金额，只有总额 / 赠送 / 充值，**没有配额上限、没有已用量、没有分母**。
 *
 * 当前用于 DeepSeek 官方 `GET /user/balance` 直查（见 docs/model-provider-deepseek-balance.md）。
 * 独立成文件：余额是可以单独描述的一组类型，不依赖统计聚合结构，
 * 且避免 usage-stats.ts 触发 oxlint max-lines 门禁。这里只依赖自身。
 */

/** 单个币种的余额明细。 */
export interface UsageProviderBalance {
  /** 币种标识，如 CNY / USD。 */
  currency: string;
  /** 账户余额总额（赠金 + 充值）。 */
  totalBalance: number;
  /** 未过期赠金余额。 */
  grantedBalance: number;
  /** 用户充值的余额。 */
  toppedUpBalance: number;
}

/** 供应商自带余额快照。 */
export interface UsageProviderBalanceSnapshot {
  /** 上游是否声明账户仍可用于调用。 */
  available: boolean;
  /** 按币种分列的余额明细；上游可能同时返回 CNY 与 USD。 */
  balances: UsageProviderBalance[];
}
