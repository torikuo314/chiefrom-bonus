// 由匯入資料產生「月業績」列；由「參數」分頁產生參數版本。純函式。
import { monthlyBonus, paramsForMonth, quarterOf } from './calc.js';

const n = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')) || 0);

/** 參數分頁列 → 版本清單。每個版本沿用先前月份未調整的參數。 */
export function paramVersions(rows) {
  const months = [...new Set(rows.map((r) => r['生效月份']).filter(Boolean))].sort();
  const cur = {};
  return months.map((m) => {
    for (const r of rows) if (r['生效月份'] === m) cur[r['參數名稱']] = n(r['數值']);
    return { effectiveMonth: m, ...cur };
  });
}

/** 訂單 line（orders.js 解析結果，已歸屬）→ 交易明細列（手機由後端轉雜湊）。 */
export function orderLineToSheetRow(l, batchId) {
  return {
    月份: l.month, 訂單號碼: l.orderNo, 列序: l.lineNo, 訂單時間: l.date, 店家: l.store, 手機: l.customer,
    分類: l.category, 類別: l.type, 品項: l.item, 工作人員: l.staff, 職位: l.role, 業績: l.amount, 項目協助: l.assist, 匯入批次: batchId,
  };
}

/** 交易明細列（字串）→ metrics.js 使用的 row。 */
export function orderLinesFromSheet(rows) {
  return rows.map((r) => ({
    orderNo: String(r['訂單號碼']), orderKey: `${r['店家']}#${r['訂單號碼']}`, lineNo: n(r['列序']), date: String(r['訂單時間']).slice(0, 10), month: r['月份'],
    store: r['店家'], customer: r['客人雜湊'] || '', category: r['分類'], type: r['類別'], item: r['品項'],
    staff: r['工作人員'], role: r['職位'] === '助理' ? '助理' : '設計師', amount: n(r['業績']), assist: n(r['項目協助']),
  }));
}

/**
 * 某月各養護師的業績統計（寫入月業績用）。
 * 業績＝所有列；服務／商品依類別；筆數、客數、客單價只看擔任設計師的列。
 */
export function monthStatsFromLines(lines, month, excludeStores = ['夥伴店']) {
  const per = new Map();
  for (const l of lines) {
    if (l.month !== month || !l.staff || excludeStores.includes(l.store)) continue;
    if (!per.has(l.staff)) per.set(l.staff, { name: l.staff, sales: 0, product: 0, designerSales: 0, orders: new Set(), customers: new Set() });
    const p = per.get(l.staff);
    p.sales += l.amount;
    if (l.type === '商品') p.product += l.amount;
    if (l.role === '設計師') {
      p.designerSales += l.amount;
      p.orders.add(l.orderKey || `${l.store}#${l.orderNo}`);
      if (l.customer) p.customers.add(l.customer);
    }
  }
  return [...per.values()].map((p) => ({
    name: p.name, sales: p.sales, product: p.product, service: p.sales - p.product,
    visits: p.orders.size, customers: p.customers.size,
    avgTicket: p.orders.size ? Math.round(p.designerSales / p.orders.size) : null,
  }));
}

/**
 * 計算某月所有養護師的月業績列。
 * stats：monthStatsFromLines 的結果；existing：月業績分頁中該月的列。
 * 保留手動調整與確認資料；業績有變動時把確認狀態改回「未確認」。
 */
export function buildMonthlyRows(month, stats, existing, params) {
  const byName = new Map(stats.map((s) => [s.name, s]));
  const names = new Set([...byName.keys(), ...existing.map((r) => r['養護師'])]);
  const rows = [];
  const changed = [];
  for (const name of names) {
    const s = byName.get(name) || { sales: 0, service: 0, product: 0, visits: 0, customers: 0, avgTicket: null };
    const old = existing.find((r) => r['養護師'] === name);
    const adj = old ? n(old['調整金額']) : 0;
    const b = monthlyBonus(s.sales + adj, params);
    const row = {
      月份: month, 養護師: name, 業績: s.sales, 服務業績: s.service, 商品業績: s.product,
      筆數: s.visits, 客數: s.customers, 客單價: s.avgTicket ?? '',
      第一級業績: b.tier1, 第二級業績: b.tier2, 當月獎金: b.bonus,
    };
    if (!old) row['確認狀態'] = '未確認';
    else if (n(old['業績']) !== s.sales && old['確認狀態'] !== '未確認') {
      row['確認狀態'] = '未確認';
      row['確認日期'] = '';
      row['確認方式'] = '';
      changed.push(name);
    }
    rows.push(row);
  }
  return { rows, changed };
}

export function isQuarterLocked(settleRows, month) {
  const q = quarterOf(month);
  return settleRows.some((r) => r['季度'] === q && r['鎖定狀態'] === '已鎖定');
}

export function paramsFor(paramRows, month) {
  return paramsForMonth(paramVersions(paramRows), month);
}

/** 手動調整後重算月業績列的獎金欄位。adj 為調整金額（可負）。 */
export function recalcWithAdjustment(row, adj, params) {
  const b = monthlyBonus(n(row['業績']) + adj, params);
  return {
    調整金額: adj,
    第一級業績: b.tier1, 第二級業績: b.tier2, 當月獎金: b.bonus,
  };
}

/** 月業績列的「有效業績」＝報表業績＋調整金額。 */
export const effectiveSales = (row) => n(row['業績']) + n(row['調整金額']);
