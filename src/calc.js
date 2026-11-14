// 頭沐 | CHIEFROM 計算核心：純函式，無 I/O，瀏覽器與 Node 共用。
// 所有參數由呼叫端傳入，不在此寫死（預設值只作為「設定」頁初始值）。

export const DEFAULT_PARAMS = Object.freeze({ T1: 140000, T2: 220000, R1: 0.2, R2: 0.3 });

/**
 * 從參數版本清單中取出某月適用的版本。
 * versions: [{ effectiveMonth: 'YYYY-MM', T1, T2, R1, R2 }, ...]
 * 規則：生效月份 <= 目標月份 中最新的一筆。
 */
export function paramsForMonth(versions, month) {
  assertMonth(month);
  const applicable = (versions || [])
    .filter((v) => v.effectiveMonth <= month)
    .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : 1));
  if (!applicable.length) throw new Error(`沒有 ${month} 適用的參數版本`);
  const p = applicable[applicable.length - 1];
  validateParams(p);
  return p;
}

export function validateParams({ T1, T2, R1, R2 }) {
  for (const [k, v] of Object.entries({ T1, T2, R1, R2 })) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`參數 ${k} 不合法：${v}`);
  }
  if (T2 < T1) throw new Error('第二級門檻 T2 不可小於第一級門檻 T1');
}

/** 每月獎金（分段累進）。回傳第一級、第二級業績與當月獎金（四捨五入到元）。 */
export function monthlyBonus(sales, params) {
  validateParams(params);
  const { T1, T2, R1, R2 } = params;
  const s = Number(sales) || 0;
  const tier1 = Math.max(0, Math.min(s, T2) - T1);
  const tier2 = Math.max(0, s - T2);
  const bonus = roundYuan(tier1 * R1 + tier2 * R2);
  return { sales: s, tier1, tier2, bonus };
}

/** 給養護師看的門檻進度（不含金額與比例）。 */
export function targetProgress(sales, { T1, T2 }) {
  if (sales >= T2) return { level: 2, text: '已達第二門檻' };
  if (sales >= T1) return { level: 1, text: '已達第一門檻', toNext: T2 - sales };
  return { level: 0, text: `距第一門檻還差 ${fmt(T1 - sales)} 元`, toNext: T1 - sales };
}

/**
 * 季結算。
 * months: [{ month, bonus, confirmed }]（該季三個月）
 */
export function quarterSettlement({ months, carryIn = 0, advances = [] }) {
  const unconfirmed = months.filter((m) => !m.confirmed).map((m) => m.month);
  if (unconfirmed.length) {
    const err = new Error(`尚有未確認月份：${unconfirmed.join('、')}`);
    err.code = 'UNCONFIRMED';
    err.months = unconfirmed;
    throw err;
  }
  const quarterBonus = months.reduce((a, m) => a + m.bonus, 0);
  const advanceTotal = advances.reduce((a, x) => a + x.amount, 0);
  const deductTotal = carryIn + advanceTotal;
  return {
    quarterBonus,
    carryIn,
    advanceTotal,
    deductTotal,
    payout: Math.max(0, quarterBonus - deductTotal),
    carryOut: Math.max(0, deductTotal - quarterBonus),
    unsignedAdvances: advances.filter((x) => !x.signed),
  };
}

/** 'YYYY-MM' → 'YYYY-Qn'；以及某季的三個月份。 */
export function quarterOf(month) {
  assertMonth(month);
  const [y, m] = month.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
}
export function monthsOfQuarter(q) {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (!m) throw new Error(`季度格式錯誤：${q}`);
  const start = (Number(m[2]) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${m[1]}-${String(start + i).padStart(2, '0')}`);
}

// 四捨五入到元（處理負數與浮點誤差）
export function roundYuan(x) {
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
}
function assertMonth(m) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error(`月份格式錯誤：${m}`);
}
const fmt = (n) => n.toLocaleString('en-US');
