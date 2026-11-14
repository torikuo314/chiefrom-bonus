// 指標計算的共用快取（內部版、月報、季報共用）。
import { buildIndex, staffMonthMetrics, radarScores, addMonths } from './metrics.js';
import { orderLinesFromSheet } from './monthly.js';

let cache = null;

function data(ctx) {
  const sig = `${ctx.db['交易明細'].length}|${ctx.db['交易明細'].at(-1)?.['匯入批次'] || ''}|${JSON.stringify(ctx.settings.metric)}`;
  if (cache?.sig === sig) return cache;
  const lines = orderLinesFromSheet(ctx.db['交易明細']);
  cache = { sig, index: buildIndex(lines, ctx.settings.metric), memo: new Map() };
  return cache;
}

/** 某人某月的指標（有快取）。 */
export function metricsOf(ctx, name, month) {
  const d = data(ctx);
  const k = `${name}|${month}`;
  if (!d.memo.has(k)) d.memo.set(k, staffMonthMetrics(d.index, name, month, ctx.settings.metric));
  return d.memo.get(k);
}

/** 某月所有在職養護師的雷達分數（店內平均只用「納入比較」的人）。 */
export function radarOf(ctx, month) {
  const staff = ctx.settings.staff;
  const list = staff.map((p) => metricsOf(ctx, p.name, month));
  return radarScores(list, staff.filter((p) => p.compare).map((p) => p.name));
}

/** 季度雷達：三個月指標平均後再標準化（同 6.3 的方式）。 */
export function quarterRadarOf(ctx, months) {
  const staff = ctx.settings.staff;
  const avgOf = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const val = (m) => (m && typeof m === 'object' ? m.value : m);
  const list = staff.map((p) => {
    const ms = months.map((m) => metricsOf(ctx, p.name, m));
    return {
      staff: p.name,
      sales: avgOf(ms.map((m) => m.sales)), avgTicket: avgOf(ms.map((m) => m.avgTicket)),
      returnRate: avgOf(ms.map((m) => val(m.returnRate))),
      productRatio: avgOf(ms.map((m) => m.productRatio)),
    };
  });
  return radarScores(list, staff.filter((p) => p.compare).map((p) => p.name));
}

const splitNames = (s) => String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/** 問卷：某人在指定月份被點名次數與勾選的讚美留言。field：'讚美勾選'（月報）或 '季讚美勾選'（季報）。 */
export function praiseOf(ctx, name, months, field = '讚美勾選') {
  const rows = ctx.db['問卷'].filter((r) => months.includes(r['月份']));
  const mentioned = rows.filter((r) => splitNames(r['對應養護師']).includes(name));
  const picked = mentioned.filter((r) => splitNames(r[field]).includes(name));
  return { mentions: mentioned.length, quotes: picked.map((r) => r['讚美文字'] || r['第一題']).filter(Boolean) };
}

export const prevMonthOf = (m) => addMonths(m, -1);

/** 某月「納入比較」者在指定指標的前三名：{ 姓名: { 指標: 名次 } }。 */
export function ranksOf(ctx, month, keyMap, topRanks) {
  const cmp = ctx.settings.staff.filter((p) => p.compare);
  const out = {};
  for (const [key, by] of Object.entries(keyMap)) {
    const entries = cmp.map((p) => { const m = metricsOf(ctx, p.name, month)[by]; return { name: p.name, value: m && typeof m === 'object' ? m.value : m }; });
    for (const [name, rank] of Object.entries(topRanks(entries))) (out[name] ??= {})[key] = rank;
  }
  return out;
}

/** 「納入比較」者的店內平均（只用來產生建議，不顯示在月報）。 */
export function storeAvgOf(ctx, month) {
  const cmp = ctx.settings.staff.filter((p) => p.compare).map((p) => metricsOf(ctx, p.name, month));
  const avg = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return {
    returnRate: avg(cmp.map((m) => m.returnRate?.value)),
    productCustomerRate: avg(cmp.map((m) => m.productCustomerRate)),
    addonRate: avg(cmp.map((m) => m.addonRate?.value)),
    workDays: avg(cmp.map((m) => m.workDays || null)),
    customers: avg(cmp.map((m) => m.customers || null)),
  };
}

/** 待回訪人數（以該月月底為基準日）。 */
export function revisitCountOf(ctx, name, month, revisitList) {
  const d = data(ctx);
  const end = (() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
  const ref = d.index.dataEnd && d.index.dataEnd < end ? d.index.dataEnd : end;
  return revisitList(d.index, name, ref, { days: ctx.settings.metric.revisitDays, maxDays: ctx.settings.metric.revisitMaxDays }).length;
}

/** 給回訪名單頁使用：索引與資料最後一天。 */
export const indexOf = (ctx) => data(ctx).index;

/** 某人近 n 個月的指標（舊→新，最後一個是 month）。 */
export function historyOf(ctx, name, month, n = 12) {
  return Array.from({ length: n }, (_, i) => addMonths(month, i - n + 1)).map((m) => metricsOf(ctx, name, m));
}
