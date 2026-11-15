// 神美（SayDou）「訂單列表」匯入解析（v2 §4）。純函式。
// 一個品項一列；同一張訂單多列。
import { classify, DEFAULT_CATEGORY_MAP, monthOf } from './metrics.js';

export const ORDER_FIELDS = [
  { key: 'orderNo', label: '訂單號碼', required: true },
  { key: 'time', label: '訂單時間', required: true },
  { key: 'store', label: '店家', required: false },
  { key: 'phone', label: '手機', required: false },
  { key: 'category', label: '分類', required: false },
  { key: 'item', label: '品項', required: false },
  { key: 'staff', label: '工作人員', required: true },
  { key: 'role', label: '職位', required: false },
  { key: 'amount', label: '業績', required: true },
  { key: 'assist', label: '項目協助', required: false },
  { key: 'pay', label: '消費方式', required: false },
];
export const DEFAULT_ORDER_MAPPING = Object.fromEntries(ORDER_FIELDS.map((f) => [f.key, f.label]));

export function checkOrderMapping(headers, mapping) {
  const missing = ORDER_FIELDS.filter((f) => (f.required && !mapping[f.key]) || (mapping[f.key] && !headers.includes(mapping[f.key]))).map((f) => f.label);
  return { ok: !missing.length, missing };
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s元$]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 訂單時間 → 'YYYY-MM-DD'。支援字串（2026-01-14 12:27、2026/1/14）與 Excel 日期序號。 */
export function toDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(String(v));
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/**
 * 解析訂單列表。
 * rows：二維陣列（第一列表頭）。resolve：姓名對應函式（importer.buildResolver）。
 * 回傳 { lines, excluded, duplicates, months }
 *  lines：計入養護師的列（含 pending：名單外的工作人員）
 *  excluded：工作人員空白、固定排除的列（附原因）
 */
export function parseOrders(rows, { mapping = DEFAULT_ORDER_MAPPING, resolve, categoryMap = DEFAULT_CATEGORY_MAP }) {
  const headers = (rows[0] || []).map((h) => String(h ?? '').trim());
  const idx = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, headers.indexOf(v)]));
  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] : null);
  const lineCount = new Map();
  const payByOrder = new Map();
  const seen = new Set();
  const lines = [], excluded = [], duplicates = [];
  rows.slice(1).forEach((r, i) => {
    if (!r || r.every((c) => c === null || c === undefined || c === '')) return;
    const orderNo = String(get(r, 'orderNo') ?? '').trim();
    const date = toDate(get(r, 'time'));
    if (!orderNo || !date) { excluded.push({ rowNo: i + 2, reason: '缺訂單號碼或日期' }); return; }
    const store = String(get(r, 'store') ?? '').trim();
    const orderKey = `${store}#${orderNo}`; // 神美的訂單號碼在不同門店會重複
    const lineNo = (lineCount.get(orderKey) || 0) + 1;
    lineCount.set(orderKey, lineNo);
    const key = `${orderKey}#${lineNo}`;
    const category = String(get(r, 'category') ?? '').trim();
    const pay = String(get(r, 'pay') ?? '').trim();
    if (pay) payByOrder.set(orderKey, pay);
    const rawStaff = String(get(r, 'staff') ?? '').trim();
    const line = {
      rowNo: i + 2, key, orderNo, orderKey, lineNo, date, month: monthOf(date),
      store,
      customer: String(get(r, 'phone') ?? '').replace(/\D/g, ''),
      category, type: classify(category, categoryMap),
      item: String(get(r, 'item') ?? '').trim(),
      rawStaff, role: String(get(r, 'role') ?? '').trim() === '助理' ? '助理' : '設計師',
      amount: num(get(r, 'amount')), assist: num(get(r, 'assist')),
    };
    if (seen.has(key)) { duplicates.push(line); return; }
    seen.add(key);
    if (!rawStaff) { excluded.push({ ...line, reason: '工作人員空白' }); return; }
    const res = resolve(rawStaff);
    if (res.status === 'excluded') { excluded.push({ ...line, staff: res.name, reason: '固定排除' }); return; }
    lines.push({ ...line, staff: res.status === 'staff' ? res.name : '', status: res.status });
  });
  markVoucherRedemptions([...lines, ...excluded], payByOrder);
  const months = [...new Set([...lines, ...excluded].map((l) => l.month).filter(Boolean))].sort();
  return { headers, lines, excluded, duplicates, months };
}

/** 套用待處理決定：{ [rawStaff]: { assignTo } | { exclude: true } }（以名稱為單位，一次處理同名的所有列）。 */
export function applyDecisions(parsed, decisions = {}) {
  const lines = [], excluded = [...parsed.excluded], pending = [];
  for (const l of parsed.lines) {
    if (l.status === 'staff') { lines.push(l); continue; }
    const d = decisions[l.rawStaff];
    if (d?.assignTo) lines.push({ ...l, staff: d.assignTo, status: 'staff' });
    else if (d?.exclude) excluded.push({ ...l, reason: '手動排除' });
    else pending.push(l);
  }
  return { lines, excluded, pending };
}

/** 匯入摘要：各月總業績、各養護師業績、待處理。 */
export function orderSummary(parsed, applied) {
  const byMonth = {};
  const add = (m) => (byMonth[m] ??= { total: 0, rows: 0, staff: {}, excluded: 0, pending: 0 });
  for (const l of applied.lines) {
    const b = add(l.month);
    b.total += l.amount; b.rows++;
    b.staff[l.staff] = (b.staff[l.staff] || 0) + l.amount;
  }
  for (const l of applied.excluded) if (l.month) add(l.month).excluded += l.amount || 0;
  for (const l of applied.pending) { const b = add(l.month); b.pending++; b.total += l.amount; }
  const pendingNames = [...new Set(applied.pending.map((l) => l.rawStaff))].map((name) => ({
    name, rows: applied.pending.filter((l) => l.rawStaff === name).length,
    amount: applied.pending.filter((l) => l.rawStaff === name).reduce((a, l) => a + l.amount, 0),
  }));
  return { months: parsed.months, byMonth, pendingNames, duplicates: parsed.duplicates.length };
}

/** 合併多個檔案的解析結果；同一「訂單號碼＋品項列序」只保留第一次出現（檔案期間重疊時）。 */
export function mergeParsed(list) {
  const seen = new Set();
  const out = { headers: list[0]?.headers || [], lines: [], excluded: [], duplicates: [], months: [] };
  for (const p of list) {
    for (const l of p.lines) (seen.has(l.key) ? out.duplicates : (seen.add(l.key), out.lines)).push(l);
    for (const e of p.excluded) {
      if (e.key && seen.has(e.key)) { out.duplicates.push(e); continue; }
      if (e.key) seen.add(e.key);
      out.excluded.push(e);
    }
    out.duplicates.push(...p.duplicates);
  }
  out.months = [...new Set([...out.lines, ...out.excluded].map((l) => l.month).filter(Boolean))].sort();
  return out;
}

/** 消費方式中的商品券金額，例如「儲值金：1380、商品券：2300」→ 2300。 */
export function voucherAmount(pay) {
  let total = 0;
  for (const m of String(pay || '').matchAll(/商品券\s*[：:]\s*([\d,]+)/g)) total += Number(m[1].replace(/,/g, '')) || 0;
  return total;
}

/**
 * 用商品券兌換的商品：神美業績報表算「使用商品券」，不算「商品銷售」。
 * 依訂單的商品券金額，把該訂單的「商品」列依序改標為「商品券兌換」（業績仍算給養護師，只是不算居家產品推薦）。
 */
export function markVoucherRedemptions(lines, payByOrder) {
  const byOrder = new Map();
  for (const l of lines) if (l.type === '商品') (byOrder.get(l.orderKey) || byOrder.set(l.orderKey, []).get(l.orderKey)).push(l);
  for (const [orderKey, items] of byOrder) {
    let left = voucherAmount(payByOrder.get(orderKey));
    for (const l of items.sort((a, b) => a.lineNo - b.lineNo)) {
      if (left <= 0) break;
      if (l.amount > 0 && l.amount <= left + 0.5) { l.type = '商品券兌換'; left -= l.amount; }
    }
  }
}
