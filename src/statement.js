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
    if (def.kind === 'pct') {
      // 使用者決定：比例改用「人次」表達（較有感），與上月比較回流的人次
      const cn = c?.num, pn = p?.num;
      if (cn != null && pn != null) {
        const d = cn - pn;
        const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
        diff = { dir, text: dir === 'flat' ? '與上月持平' : `${dir === 'up' ? '多' : '少'} ${Math.abs(d)} 人次回流` };
      }
    } else {
      const d = Math.round(v - pv);
      const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      diff = { dir, text: dir === 'flat' ? '與上月持平' : `${dir === 'up' ? '多' : '少'} ${fmt(Math.abs(d))} ${def.unit}` };
    }
  }
  const small = !!(c && typeof c === 'object' && c.smallSample);
  const history = extra.history || [];
  const spark = history.slice(-6).map((h) => (h ? val(h[def.key]) ?? null : null));
  const best = def.best && !pending && isPersonalBest(v, history.slice(0, -1).map((h) => (h ? h[def.key] : null)));
  const { history: _h, ...rest } = extra;
  return { key: def.key, label: def.label, value, unit: !pending && v != null && def.kind !== 'pct' ? def.unit : '', diff, small, pending, spark, best, ...rest };
}

// 建議文字庫：同一種情況有多種說法，依「姓名＋月份」輪替，每個月看到的不一樣
export const TIP_POOL = {
  returnLow: [
    { icon: '💪', text: '顧客回流率可以再加油！服務結束時，記得幫客人預約下次回來的時間。' },
    { icon: '💬', text: '服務後 3–7 天傳個 LINE 關心客人的頭皮狀況，客人會更想回來喔！' },
    { icon: '📅', text: '結帳時可以依療程週期幫客人約好下次（例如草本染髮約 6–8 週補染、頭皮護理約 4 週）。' },
  ],
  fewCustomers: [
    { icon: '📞', text: '本月接客比較少，可以主動聯繫久沒回來的老客人，邀請她們預約回來保養！' },
    { icon: '🍂', text: '可以趁換季或節日前，邀請老客人回來做頭皮保養。' },
    { icon: '🤝', text: '客人稱讚你的時候，可以請她把你介紹給朋友！' },
  ],
  productLow: [
    { icon: '🌿', text: '可以多和客人分享居家保養，幫客人把養護效果延續到家裡。' },
    { icon: '🧴', text: '買過養髮液的客人快用完時關心一下，順便邀請回來做頭皮檢測。' },
  ],
  addonLow: [
    { icon: '✨', text: '可以多推薦加值服務，讓客人的體驗更完整。' },
    { icon: '💡', text: '服務時可以依客人的頭皮狀況，建議適合的加值項目。' },
  ],
};
const pickTip = (list, seed) => list[seed % list.length];
export const tipSeed = (name = '', month = '') => [...name].reduce((a, c) => a + c.charCodeAt(0), 0) + Number(month.slice(5) || 0);

/**
 * 給你的小建議（依表現自動產生）：恭喜最多 1 則＋實際建議最多 3 則。
 * me：本月指標；prev：上月指標；avg：店內平均（只用來判斷，不顯示）；progress：門檻進度
 * revisit：待回訪人數；seed：輪替用（姓名＋月份）。「偏少」＝低於店內平均的 9 成。
 */
export function buildTips({ me = {}, prev = {}, avg = {}, progress, salesBest = false, ranks = {}, revisit = 0, revisitDays = 45, seed = 0 }) {
  const tips = [];
  const low = (v, a) => v != null && a != null && a > 0 && v < a * 0.9;
  const cheer = salesBest ? { icon: '🎉', text: '本月業績創個人新高，太棒了！' }
    : Object.keys(ranks).length ? { icon: '👏', text: '本月有項目進入店內前三名，做得很好！' } : null;
  // 使用者說明：客人由公司分配 → 建議只放養護師自己能做到的事，並以下個月為目標
  const goal = progress && progress.level < 2 && progress.toNext > 0 ? (progress.level === 0 ? '第一' : '第二') : null;
  if (goal && me.customers) {
    const per = Math.ceil(progress.toNext / me.customers / 10) * 10;
    tips.push({ icon: '🎯', text: `下個月每位客人平均多約 ${per.toLocaleString('en-US')} 元（例如多一項加值服務或居家保養），就有機會達到${goal}門檻！` });
  }
  if (revisit >= 3) tips.push({ icon: '📋', text: `你有 ${revisit} 位客人超過 ${revisitDays} 天還沒回來，可以主動關心、邀請她們預約！（名單可以向店長拿）` });
  const r = me.returnRate?.value, pr = prev.returnRate?.value;
  if (low(r, avg.returnRate) || (r != null && pr != null && me.returnRate.num < prev.returnRate.num)) tips.push(pickTip(TIP_POOL.returnLow, seed));
  // 使用者決定：不提排班或休假
  if ((me.workDays && avg.workDays && me.workDays < avg.workDays * 0.9) || low(me.customers, avg.customers)) tips.push(pickTip(TIP_POOL.fewCustomers, seed));
  if (low(me.productCustomerRate, avg.productCustomerRate)) tips.push(pickTip(TIP_POOL.productLow, seed));
  if (low(me.addonRate?.value, avg.addonRate)) tips.push(pickTip(TIP_POOL.addonLow, seed));
  if (!tips.length) tips.push({ icon: '🌱', text: '各項表現都很穩定，繼續保持！' });
  return [...(cheer ? [cheer] : []), ...tips.slice(0, 3)];
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
    const r = cur?.returnRate;
    const note = d.key === 'returnRate' && r?.baseMonth && r.den
      ? `${Number(r.baseMonth.slice(5))} 月服務 ${r.den} 人次，有 ${r.num} 人次在 ${extra.returnDays || 60} 天內回來` : '';
    return buildCard(d, cur, prev, { note, rank: extra.ranks?.[d.key] || null, ranked: d.key in RANKED_KEYS && !!extra.compared, history: extra.history || [] });
  });
  const salesHistory = lastMonths(month, 12).map((m) => { const r = mine.find((x) => x['月份'] === m); return r ? effectiveSales(r) : null; });
  const result = {
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
    tips: buildTips({ me: cur || {}, prev: prev || {}, avg: extra.storeAvg || {}, progress: p, salesBest: isPersonalBest(sales, salesHistory.slice(0, -1)), ranks: extra.ranks || {},
      revisit: extra.revisit || 0, revisitDays: extra.revisitDays || 45, seed: tipSeed(name, month) }),
    praise: praise && praise.quotes.length ? { mentions: praise.mentions, quotes: praise.quotes.slice(0, 3) } : null,
  };
  // 建議 4 則時留言最多 2 則，確保一頁 A4 放得下
  if (result.praise && result.tips.length >= 4) result.praise.quotes = result.praise.quotes.slice(0, 2);
  return result;
}
