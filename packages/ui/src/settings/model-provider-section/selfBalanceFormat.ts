/* 供应商自带余额的金额格式化（设置页余额卡与聊天 context 面板共用）。
 *
 * 两端曾各写一份逐字相同的格式化逻辑，格式调整漏改任一处就会出现
 * 设置页与气泡面板金额展示不一致；抽到同一入口避免再分叉。
 */

/** 币种符号；未知币种回退为货币代码本身，避免展示成空白。 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "¥",
};

export function formatBalanceAmount(
  locale: string,
  amount: number,
  currency: string,
): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  const formatted = new Intl.NumberFormat(locale || undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
}
