// 經營指標計算核心（v2 §6）。純函式，不含 I/O。
// 輸入的交易列（row）格式：
//   { orderNo, lineNo, date: 'YYYY-MM-DD', store, customer: 手機或雜湊（空字串＝無）,
//     category: 分類（神美原始值）, type: 類別（classify 後）, staff, role: '設計師'|'助理',
//     amount: 業績, assist: 項目協助 }

export const DEFAULT_METRIC_SETTINGS = Object.freeze({
  returnDays: 60,        // 顧客回流天數（使用者決定：新舊客合併為一項，60 天）
  newReturnDays: 75,     // （保留：新客回店率，目前報表未使用）
  newWindowMonths: 3,    // 新客基準期間長度（月）
  minSample: 5,          // 基準人數少於此值加註「樣本數少」
  excludeStores: ['夥伴店'], // 不計入門店養護師指標的店家
});

export const DEFAULT_CATEGORY_MAP = Object.freeze({
  exact: { 商品: '商品', 附加服務: '加購服務' },
  prefix: { 方案: '方案' },
  bracket: { 草本染髮: '草本染髮', 頭皮護理: '頭皮護理', 結構式護髮: '護髮', 低敏染髮: '低敏染髮' },
});

/** 神美「分類」→ 報表類別。對照表可在設定頁修改。 */
export function classify(category, map = DEFAULT_CATEGORY_MAP) {
  const c = String(category ?? '').trim();
  if (!c) return '其他';
  if (map.exact[c]) return map.exact[c];
  for (const [p, label] of Object.entries(map.prefix)) if (c.startsWith(p)) return label;
  const m = /【([^】]+)】/.exec(c);
  if (m) {
    const inner = m[1].replace(/[\d.\-–~～]+\s*(hr|h|小時).*$/i, '').trim();
    return map.bracket[inner] || inner;
  }
  return c;
}

// ---- 日期工具（以 UTC 日計算，避免時區誤差） ----
const DAY = 86400000;
const toDay = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY);
const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const monthOf = (d) => d.slice(0, 7);
export function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number);
  return fromDay(Math.floor(Date.UTC(y, m, 0) / DAY));
}
export function addMonths(month, k) {
  let [y, m] = month.split('-').map(Number);
  m += k;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
export const addDays = (d, k) => fromDay(toDay(d) + k);
export const daysBetween = (a, b) => toDay(b) - toDay(a);

/**
 * 建立共用索引：每位客人的到店日期（排序、不重複）、首次消費日與首次消費的設計師。
 * 只用「計入指標」的列（排除夥伴店）。
 */
export function buildIndex(rows, settings = DEFAULT_METRIC_SETTINGS) {
  const ex = new Set(settings.excludeStores);
  const valid = rows.filter((r) => r.date && !ex.has(r.store));
  const visits = new Map(); // customer -> Set(date)
  const firstDesigners = new Map(); // customer -> { date, designers:Set }
  for (const r of valid) {
    if (!r.customer) continue;
    if (!visits.has(r.customer)) visits.set(r.customer, new Set());
    visits.get(r.customer).add(r.date);
  }
  const sortedVisits = new Map([...visits].map(([c, s]) => [c, [...s].sort()]));
  for (const r of valid) {
    if (!r.customer || r.role !== '設計師' || !r.staff) continue;
    const first = sortedVisits.get(r.customer)[0];
    if (r.date !== first) continue;
    if (!firstDesigners.has(r.customer)) firstDesigners.set(r.customer, { date: first, designers: new Set() });
    firstDesigners.get(r.customer).designers.add(r.staff);
  }
  const dates = valid.map((r) => r.date).sort();
  return { valid, visits: sortedVisits, firstDesigners, dataStart: dates[0] || null, dataEnd: dates.at(-1) || null };
}

/** 客人在 date 之後（不含當天）的下一次到店日。 */
function nextVisit(index, customer, date) {
  const list = index.visits.get(customer) || [];
  return list.find((d) => d > date) || null;
}

const ratio = (num, den, settings, extra = {}) => ({
  value: den ? num / den : null,
  num, den,
  smallSample: den > 0 && den < settings.minSample,
  pending: false,
  ...extra,
});
const pendingResult = (extra = {}) => ({ value: null, num: 0, den: 0, smallSample: false, pending: true, ...extra });

/**
 * 某位養護師某月的指標（核心 7 項＋內部指標）。
 */
export function staffMonthMetrics(index, staff, month, settings = DEFAULT_METRIC_SETTINGS) {
  const inMonth = index.valid.filter((r) => r.staff === staff && monthOf(r.date) === month);
  const designer = inMonth.filter((r) => r.role === '設計師');
  const assistant = inMonth.filter((r) => r.role === '助理');
  const sum = (arr) => arr.reduce((a, r) => a + r.amount, 0);

  const designerOrders = new Set(designer.map((r) => r.orderNo));
  const designerSales = sum(designer);

  // 7. 加購服務率：X 擔任設計師的訂單中，含「加購服務」列的訂單比例
  const addonOrders = new Set(index.valid.filter((r) => designerOrders.has(r.orderNo) && r.type === '加購服務').map((r) => r.orderNo));

  return {
    staff, month,
    sales: sum(inMonth),                                                   // 1. 個人業績
    avgTicket: designerOrders.size ? designerSales / designerOrders.size : null, // 2. 客單價
    customers: new Set(designer.map((r) => r.customer).filter(Boolean)).size,    // 3. 服務客數
    returnRate: returnRate(index, staff, month, settings),                  // 4. 顧客回流率（新舊客合併）
    productRatio: designerSales ? sum(designer.filter((r) => r.type === '商品')) / designerSales : null, // 6.
    addonRate: ratio(addonOrders.size, designerOrders.size, settings),      // 7.
    orders: designerOrders.size,
    // 使用者決定：月報改用次數呈現（較具體、較有激勵感），排名仍用比例以求公平
    productCustomers: new Set(designer.filter((r) => r.type === '商品').map((r) => r.customer || `#${r.orderNo}`)).size,
    productCustomerRate: (() => {
      const all = new Set(designer.map((r) => r.customer || `#${r.orderNo}`)).size;
      return all ? new Set(designer.filter((r) => r.type === '商品').map((r) => r.customer || `#${r.orderNo}`)).size / all : null;
    })(),
    addonCount: addonOrders.size,
    workDays: new Set(inMonth.map((r) => r.date)).size, // 有接客（任何職位）的天數
    mix: designer.reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + r.amount), m), {}),
    // 內部指標
    newCustomers: [...index.firstDesigners].filter(([, f]) => monthOf(f.date) === month && f.designers.has(staff)).length,
    assistUsed: { count: designer.filter((r) => r.assist > 0).length, amount: designer.reduce((a, r) => a + (r.assist || 0), 0) },
    asAssistant: { count: assistant.length, amount: sum(assistant) },
  };
}

/**
 * 4. 顧客回流率（使用者決定：原「老客準時回店率」與「新客回店率」合併為一項）
 * 基準月 B：「月底＋N 天」不晚於 M 月底的最近一個月份（N＝60 時約為 M−2）。
 * 基準：B 月中 X 擔任設計師的所有消費（含新客第一次，以訂單計，需有客人識別）。
 * 分子：其中客人下一次到店（任何養護師）間隔 ≤ N 天的筆數。
 */
export function returnRate(index, staff, month, settings = DEFAULT_METRIC_SETTINGS) {
  const N = settings.returnDays;
  const end = lastDayOf(month);
  let base = month;
  while (addDays(lastDayOf(base), N) > end) base = addMonths(base, -1);
  if (!index.dataStart || index.dataStart > `${base}-01`) return pendingResult({ baseMonth: base });
  const orders = new Map(); // orderNo -> { customer, date }
  for (const r of index.valid) {
    if (r.staff === staff && r.role === '設計師' && monthOf(r.date) === base && r.customer) orders.set(r.orderNo, { customer: r.customer, date: r.date });
  }
  let num = 0;
  for (const o of orders.values()) {
    const nv = nextVisit(index, o.customer, o.date);
    if (nv && daysBetween(o.date, nv) <= N) num++;
  }
  return ratio(num, orders.size, settings, { baseMonth: base });
}

/**
 * 5. 新客回店率
 * 截止日＝M 月底 − N 天；基準期間＝截止日往前 W 個月（不含起點、含截止日）。
 * 新客：首次消費日落在基準期間、且首次消費由 X 擔任設計師。
 * 分子：首次消費後 N 天內有再到店（任何養護師）的人數。
 */
export function newReturnRate(index, staff, month, settings = DEFAULT_METRIC_SETTINGS) {
  const N = settings.newReturnDays;
  const cutoff = addDays(lastDayOf(month), -N);
  const startMonth = addMonths(monthOf(cutoff), -settings.newWindowMonths);
  const startRaw = `${startMonth}-${cutoff.slice(8, 10)}`;
  const start = startRaw > lastDayOf(startMonth) ? lastDayOf(startMonth) : startRaw; // 不含此日
  const label = { from: monthOf(addDays(start, 1)), to: monthOf(cutoff) };
  // 資料需涵蓋整個基準期間
  if (!index.dataStart || index.dataStart > addDays(start, 1)) return pendingResult({ window: label });
  let den = 0, num = 0;
  for (const [customer, f] of index.firstDesigners) {
    if (!f.designers.has(staff) || f.date <= start || f.date > cutoff) continue;
    den++;
    const nv = nextVisit(index, customer, f.date);
    if (nv && daysBetween(f.date, nv) <= N) num++;
  }
  return ratio(num, den, settings, { window: label });
}

/** 將比例型指標取數值（物件或數字皆可）。 */
export const valueOf = (m) => (m && typeof m === 'object' ? m.value : m);

export const RADAR_AXES = [
  { key: 'sales', label: '產能' },
  { key: 'avgTicket', label: '客單' },
  { key: 'returnRate', label: '回流' },
  { key: 'productRatio', label: '推薦' },
];

/**
 * 雷達分數：分數 = 50 × 個人值 ÷ 店內平均，上限 100。
 * metricsList：當月所有養護師的指標；compareNames：納入比較的姓名。
 * 回傳 { [姓名]: { sales: 分數|null, ... } }
 */
export function radarScores(metricsList, compareNames) {
  const cmp = metricsList.filter((m) => compareNames.includes(m.staff));
  const avg = {};
  for (const { key } of RADAR_AXES) {
    const vals = cmp.map((m) => valueOf(m[key])).filter((v) => v != null);
    avg[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const out = {};
  for (const m of metricsList) {
    out[m.staff] = {};
    for (const { key } of RADAR_AXES) {
      const v = valueOf(m[key]);
      out[m.staff][key] = v == null || !avg[key] ? null : Math.min(100, Math.round((50 * v) / avg[key]));
    }
  }
  return out;
}

/** 與上月比較：回傳差異（比例型為百分點，其餘為數值差）。 */
export function compare(cur, prev) {
  const a = valueOf(cur), b = valueOf(prev);
  if (a == null || b == null) return null;
  return a - b;
}

/** 連續 N 個月下滑：values 依月份排序（舊→新），最後 N 次都比前一個月低。 */
export function declining(values, n = 3) {
  const v = values.map(valueOf);
  if (v.length < n + 1) return false;
  for (let i = v.length - n; i < v.length; i++) {
    if (v[i] == null || v[i - 1] == null || !(v[i] < v[i - 1])) return false;
  }
  return true;
}
