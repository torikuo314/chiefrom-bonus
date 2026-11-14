// 個人經營月報（給養護師）資料整理（v2 §8）。純函式。
// 依使用者決定：顯示「本月預估獎金」與「本季已預支」（註明以季結算為準）；不放確認欄。
// 不放：比例、第一／二級業績、店內平均數字、指定率、問卷星數、負評、主管回饋。
// 排名：使用者決定只在「商品推薦佔比」「加購服務率」標示店內前三名，其餘不顯示。
import { targetProgress, quarterOf } from './calc.js';
import { effectiveSales } from './monthly.js';

const n = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')) || 0);
const fmt = (v) => Math.round(v).toLocaleString('en-US');

export function lastMonths(month, count) {
  let [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    if (--m < 1) { m = 12; y--; }
  }
  return out;
}

// 月報的 6 張指標卡
export const CARD_DEFS = [
  { key: 'avgTicket', label: '客單價', kind: 'money', unit: '元', best: true },
  { key: 'customers', label: '服務客數', kind: 'count', unit: '人', best: true },
  { key: 'returnRate', label: '顧客回流率', kind: 'pct' },
  { key: 'productCustomers', label: '居家保養推薦', kind: 'count', unit: '位客人', best: true },
  { key: 'addonCount', label: '加值服務', kind: 'count', unit: '次', best: true },
];

// 服務項目佔比的類別順序（顏色依此固定順序，不隨排名變動）
export const MIX_ORDER = ['草本染髮', '頭皮護理', '護髮', '方案', '商品', '加購服務'];

const val = (m) => (m && typeof m === 'object' ? m.value : m);

// 排名用比例計算（客人少的人也有公平機會），月報上顯示次數
export const RANKED_KEYS = { productCustomers: 'productCustomerRate', addonCount: 'addonRate' };

/**
 * 店內排名（同分同名次：1、1、3）。entries：[{ name, value }]；只回傳前 topN 名且數值 > 0 的名次。
 */
export function topRanks(entries, topN = 3) {
  const valid = entries.filter((e) => e.value != null && e.value > 0);
  const out = {};
  for (const e of valid) {
    const rank = 1 + valid.filter((x) => x.value > e.value).length;
    if (rank <= topN) out[e.name] = rank;
  }
  return out;
}

/** 個人新高：本月數值大於自己前 11 個月的最高值（至少要有 3 個月紀錄、且大於 0）。 */
export function isPersonalBest(value, previous) {
  const prior = previous.map(val).filter((v) => v != null);
  return value != null && value > 0 && prior.length >= 3 && value > Math.max(...prior);
}

/** 指標卡：本月數值＋與自己上月比較。 */
export function buildCard(def, cur, prev, extra = {}) {
  const c = cur?.[def.key];
  const p = prev?.[def.key];
  const pending = !!(c && typeof c === 'object' && c.pending);
  const v = val(c);
  const pv = val(p);
  const value = pending ? '資料累積中' : v == null ? '—' : def.kind === 'pct' ? `${Math.round(v * 100)}%` : fmt(v);
  let diff = null;
  if (!pending && v != null && pv != null) {
    const d = def.kind === 'pct' ? Math.round((v - pv) * 100) : Math.round(v - pv);
    const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const amount = def.kind === 'pct' ? `${Math.abs(d)} 個百分點` : `${fmt(Math.abs(d))} ${def.unit}`;
    diff = { dir, text: dir === 'flat' ? '與上月持平' : `${dir === 'up' ? '↑' : '↓'} ${amount}` };
  }
  const small = !!(c && typeof c === 'object' && c.smallSample);
  const history = extra.history || [];
  const spark = history.slice(-6).map((h) => (h ? val(h[def.key]) ?? null : null));
  const best = def.best && !pending && isPersonalBest(v, history.slice(0, -1).map((h) => (h ? h[def.key] : null)));
  const { history: _h, ...rest } = extra;
  return { key: def.key, label: def.label, value, unit: !pending && v != null && def.kind !== 'pct' ? def.unit : '', diff, small, pending, spark, best, ...rest };
}

/** 服務項目佔比：固定順序，其餘併入「其他」。 */
export function buildMix(mix = {}) {
  const items = MIX_ORDER.map((k) => ({ label: k, amount: Math.max(0, n(mix[k])) }));
  const other = Object.entries(mix).filter(([k]) => !MIX_ORDER.includes(k)).reduce((a, [, v]) => a + Math.max(0, n(v)), 0);
  if (other > 0) items.push({ label: '其他', amount: other });
  const total = items.reduce((a, x) => a + x.amount, 0);
  return { total, items: items.filter((x) => x.amount > 0).map((x) => ({ ...x, percent: total ? Math.round((x.amount / total) * 100) : 0 })) };
}

/**
 * monthlyRows：月業績分頁全部列；params：該月參數（只用 T1、T2 決定進度）；advanceRows：預支分頁
 * extra：{ cur, prev：本月／上月指標（metrics.js），radar：本人雷達分數，praise：{ mentions, quotes } }
 */
export function buildStatement(monthlyRows, name, month, params, advanceRows = [], extra = {}) {
  const mine = monthlyRows.filter((r) => r['養護師'] === name);
  const row = mine.find((r) => r['月份'] === month);
  if (!row) throw new Error(`${name} ${month} 沒有月業績資料`);
  const sales = effectiveSales(row);
  const trend = lastMonths(month, 6).map((m) => {
    const r = mine.find((x) => x['月份'] === m);
    return { month: m, sales: r ? effectiveSales(r) : null };
  });
  const p = targetProgress(sales, params);
  const scaleMax = Math.max(params.T2 * 1.15, sales * 1.05);
  const { cur, prev, praise } = extra;
  const cards = CARD_DEFS.map((d) => {
    const note = d.key === 'returnRate' && cur?.returnRate?.baseMonth ? `${Number(cur.returnRate.baseMonth.slice(5))} 月服務的客人，${extra.returnDays || 60} 天內再回店的比例` : '';
    return buildCard(d, cur, prev, { note, rank: extra.ranks?.[d.key] || null, history: extra.history || [] });
  });
  const salesHistory = lastMonths(month, 12).map((m) => { const r = mine.find((x) => x['月份'] === m); return r ? effectiveSales(r) : null; });
  return {
    name, month, sales,
    salesBest: isPersonalBest(sales, salesHistory.slice(0, -1)),
    estimatedBonus: n(row['當月獎金']),
    quarterAdvance: advanceRows
      .filter((a) => a['養護師'] === name && a['扣抵季度'] === quarterOf(month) && String(a['日期']).slice(0, 7) <= month)
      .reduce((s, a) => s + n(a['金額']), 0),
    progress: {
      level: p.level, text: p.text,
      T1: params.T1, T2: params.T2,
      percent: Math.min(100, (sales / scaleMax) * 100),
      marks: [
        { label: '第一門檻', percent: (params.T1 / scaleMax) * 100 },
        { label: '第二門檻', percent: (params.T2 / scaleMax) * 100 },
      ],
    },
    cards,
    smallSampleNote: cards.some((c) => c.small),
    trend,
    // 使用者決定：沒有勾選留言時整區隱藏
    praise: praise && praise.quotes.length ? { mentions: praise.mentions, quotes: praise.quotes.slice(0, 3) } : null,
  };
}
