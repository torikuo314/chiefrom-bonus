// 匯入核心：純函式。輸入為 SheetJS 讀出的二維陣列（第一列為表頭）。
// 支援 POS「已按人彙總」報表：每列＝一位人員的一個身分（設計師／助理）。

/** 系統欄位定義（彙總報表格式）。 */
export const SUMMARY_FIELDS = [
  { key: 'staff', label: '養護師', required: true },
  { key: 'service', label: '服務業績', required: true },
  { key: 'product', label: '商品業績', required: false },
  { key: 'visits', label: '服務筆數（客次）', required: false },
  { key: 'customers', label: '客數', required: false },
];

/** 依目前 POS 範例檔的預設對應（可在設定頁修改）。 */
export const DEFAULT_MAPPING = {
  staff: '工作人員',
  service: '總服務實業績',
  product: '商品銷售實業績',
  visits: '總客次',
  customers: '總客數',
};

/** 客次／客數只計入這個身分的列（使用者決定：只算設計師列）。 */
export const DEFAULT_COUNT_ROLE = '設計師';

/** 從工作表名稱或檔名判斷月份。回傳 ['YYYY-MM', ...]（跨月時多個）。 */
export function detectMonths(text) {
  const re = /(\d{4})\s*[年_\-/.]\s*(\d{1,2})\s*[月_\-/.]\s*(\d{1,2})/g;
  const found = [];
  let m;
  while ((m = re.exec(text || ''))) found.push(`${m[1]}-${m[2].padStart(2, '0')}`);
  if (found.length >= 2) return monthRange(found[0], found[found.length - 1]);
  return [...new Set(found)];
}
function monthRange(a, b) {
  if (a > b) [a, b] = [b, a];
  const out = [];
  let [y, mo] = a.split('-').map(Number);
  for (;;) {
    const s = `${y}-${String(mo).padStart(2, '0')}`;
    out.push(s);
    if (s >= b) break;
    if (++mo > 12) { mo = 1; y++; }
  }
  return out;
}

/** 檢查已存的對應是否套得上這個檔案的表頭；套不上時回傳缺少的欄位。 */
export function checkMapping(headers, mapping) {
  const missing = SUMMARY_FIELDS
    .filter((f) => mapping[f.key] && !headers.includes(mapping[f.key]))
    .map((f) => f.label);
  const unmappedRequired = SUMMARY_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  return { ok: !missing.length && !unmappedRequired.length, missing: [...missing, ...unmappedRequired] };
}

/** 「小美 設計師」→ { base: '小美', role: '設計師' } */
export function splitNameRole(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const m = /^(.*?)\s*(設計師|助理|養護師)$/.exec(s);
  return m && m[1] ? { base: m[1].trim(), role: m[2] } : { base: s, role: '' };
}

/**
 * 建立名稱查找表。
 * staff: [{ name, aliases: ['王小美', ...], store, active }]
 * excluded: ['某某', ...]
 */
export function buildResolver(staff, excluded = []) {
  const norm = (s) => String(s).trim().toLowerCase();
  const map = new Map();
  for (const p of staff) {
    for (const n of [p.name, ...(p.aliases || [])]) if (n) map.set(norm(n), p.name);
  }
  const ex = new Set(excluded.map(norm));
  return (raw) => {
    const { base, role } = splitNameRole(raw);
    const full = norm(raw);
    if (map.has(full)) return { status: 'staff', name: map.get(full), role };
    if (map.has(norm(base))) return { status: 'staff', name: map.get(norm(base)), role };
    if (ex.has(full) || ex.has(norm(base))) return { status: 'excluded', name: base, role };
    return { status: 'pending', name: base, role };
  };
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s元$]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * 解析一份彙總報表。
 * rows: 二維陣列（含表頭）；store: 門店名稱
 * 回傳每列結果（含歸屬狀態），尚未加總。
 */
export function parseSummary(rows, { mapping, store, resolve }) {
  const headers = (rows[0] || []).map((h) => String(h ?? '').trim());
  const col = (k) => (mapping[k] ? headers.indexOf(mapping[k]) : -1);
  const idx = Object.fromEntries(Object.keys(mapping).map((k) => [k, col(k)]));
  if (idx.staff < 0 || idx.service < 0) throw new Error('欄位對應不完整：養護師與服務業績為必填');
  const get = (r, k) => (idx[k] >= 0 ? num(r[idx[k]]) : 0);

  const lines = [];
  rows.slice(1).forEach((r, i) => {
    if (!r || r.every((c) => c === null || c === undefined || c === '')) return;
    const rawName = String(r[idx.staff] ?? '').trim();
    const service = get(r, 'service');
    const product = get(r, 'product');
    const res = rawName ? resolve(rawName) : { status: 'pending', name: '', role: '' };
    lines.push({
      rowNo: i + 2, store, rawName, ...res,
      service, product, amount: service + product,
      visits: get(r, 'visits'), customers: get(r, 'customers'),
    });
  });
  return { headers, lines };
}

/**
 * 加總成每位養護師的月業績。
 * lines: 多份報表（多門店）解析結果合併；pending 列須先由使用者指定 assignTo 或 exclude。
 * decisions: { [rowKey]: { assignTo?: '姓名', exclude?: true } }，rowKey = `${store}#${rowNo}`
 */
export function aggregate(lines, { decisions = {}, countRole = DEFAULT_COUNT_ROLE } = {}) {
  const per = new Map();
  const excluded = [];
  const pending = [];
  for (const l of lines) {
    const key = rowKey(l);
    const d = decisions[key];
    let name = null;
    if (l.status === 'staff') name = l.name;
    else if (d?.assignTo) name = d.assignTo;
    else if (l.status === 'excluded' || d?.exclude) { excluded.push(l); continue; }
    else { pending.push(l); continue; }

    if (!per.has(name)) {
      per.set(name, { name, sales: 0, service: 0, product: 0, visits: 0, customers: 0, byStore: {} });
    }
    const p = per.get(name);
    p.sales += l.amount;
    p.service += l.service;
    p.product += l.product;
    if (!countRole || l.role === countRole || l.role === '') {
      p.visits += l.visits;
      p.customers += l.customers;
    }
    p.byStore[l.store] = (p.byStore[l.store] || 0) + l.amount;
  }
  const staff = [...per.values()].map((p) => ({
    ...p,
    avgTicket: p.customers ? Math.round(p.sales / p.customers) : null,
  }));
  return { staff, excluded, pending };
}
export const rowKey = (l) => `${l.store}#${l.rowNo}`;

/** 匯入摘要（供與 POS 總額核對）。 */
export function summarize(lines, agg) {
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const byStore = {};
  for (const l of lines) {
    byStore[l.store] ??= { rows: 0, amount: 0 };
    byStore[l.store].rows++;
    byStore[l.store].amount += l.amount;
  }
  return {
    rows: lines.length,
    total: sum(lines, 'amount'),
    byStore,
    staffTotal: sum(agg.staff, 'sales'),
    excludedTotal: sum(agg.excluded, 'amount'),
    pendingCount: agg.pending.length,
    pendingTotal: sum(agg.pending, 'amount'),
  };
}

/**
 * 重複匯入檢查：同月份＋同門店已有批次 → 需詢問覆蓋或取消。
 * batches: [{ month, store, batchId, importedAt }]
 */
export function findConflict(batches, month, store) {
  return (batches || []).find((b) => b.month === month && b.store === store) || null;
}
