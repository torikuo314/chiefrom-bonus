// 每月業績明細（給養護師）資料整理。純函式。
// 只顯示「本月預估獎金」（實際以季結算為準）；不顯示比例與第一／二級業績。
import { targetProgress, quarterOf } from './calc.js';
import { effectiveSales } from './monthly.js';

const n = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')) || 0);

export function lastMonths(month, count) {
  let [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    if (--m < 1) { m = 12; y--; }
  }
  return out;
}

/**
 * monthlyRows：月業績分頁全部列；params：該月參數（只用 T1、T2 決定進度位置）
 * advanceRows：預支分頁全部列（用來算本季截至當月的累計預支）
 */
export function buildStatement(monthlyRows, name, month, params, advanceRows = []) {
  const mine = monthlyRows.filter((r) => r['養護師'] === name);
  const row = mine.find((r) => r['月份'] === month);
  if (!row) throw new Error(`${name} ${month} 沒有月業績資料`);
  const sales = effectiveSales(row);
  const months6 = lastMonths(month, 6);
  const trend = months6.map((m) => {
    const r = mine.find((x) => x['月份'] === m);
    return { month: m, sales: r ? effectiveSales(r) : null };
  });
  const prev = trend[4].sales;
  const p = targetProgress(sales, params);
  const scaleMax = Math.max(params.T2 * 1.15, sales * 1.05);
  return {
    name, month, sales,
    estimatedBonus: n(row['當月獎金']),
    quarterAdvance: advanceRows
      .filter((a) => a['養護師'] === name && a['扣抵季度'] === quarterOf(month) && String(a['日期']).slice(0, 7) <= month)
      .reduce((s, a) => s + n(a['金額']), 0),
    progress: {
      level: p.level,
      text: p.text,
      percent: Math.min(100, (sales / scaleMax) * 100),
      marks: [
        { label: '第一門檻', percent: (params.T1 / scaleMax) * 100 },
        { label: '第二門檻', percent: (params.T2 / scaleMax) * 100 },
      ],
    },
    mix: { service: n(row['服務業績']), product: n(row['商品業績']) },
    trend,
    metrics: {
      visits: n(row['筆數']),
      customers: n(row['客數']),
      avgTicket: n(row['客數']) ? Math.round(sales / n(row['客數'])) : null,
      momPercent: prev ? Math.round(((sales - prev) / prev) * 1000) / 10 : null,
    },
  };
}
