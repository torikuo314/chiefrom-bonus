// 由匯入資料產生「月業績」列；由「參數」分頁產生參數版本。純函式。
import { aggregate } from './importer.js';
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

/** 交易明細列（字串）→ importer 的 line 物件。 */
export function linesFromSheet(rows) {
  return rows.map((r, i) => ({
    rowNo: i, store: r['門店'], rawName: r['報表名稱'], name: r['養護師'], role: r['身分'],
    status: r['處理'] === '排除' ? 'excluded' : r['處理'] === '待處理' ? 'pending' : 'staff',
    service: n(r['服務業績']), product: n(r['商品業績']), amount: n(r['金額']),
    visits: n(r['客次']), customers: n(r['客數']),
  }));
}

/** importer line（已套用待處理決定）→ 交易明細列。 */
export function lineToSheetRow(l, month, batchId, decision) {
  const assigned = l.status === 'staff' ? l.name : decision?.assignTo || '';
  const how = l.status === 'staff' ? '計入' : decision?.assignTo ? '指定歸屬' : '排除';
  return {
    月份: month, 門店: l.store, 報表名稱: l.rawName, 養護師: assigned, 身分: l.role, 處理: how,
    服務業績: l.service, 商品業績: l.product, 金額: l.amount, 客次: l.visits, 客數: l.customers, 匯入批次: batchId,
  };
}

/**
 * 計算某月所有養護師的月業績列。
 * monthLines：該月全部門店的 line（已歸屬）；existing：月業績分頁中該月的列。
 * 保留手動調整與確認資料；業績有變動時把確認狀態改回「未確認」。
 */
export function buildMonthlyRows(month, monthLines, existing, params) {
  const { staff } = aggregate(monthLines.filter((l) => l.status !== 'excluded'));
  const byName = new Map(staff.map((s) => [s.name, s]));
  const names = new Set([...byName.keys(), ...existing.map((r) => r['養護師'])]);
  const rows = [];
  const changed = [];
  for (const name of names) {
    const s = byName.get(name) || { sales: 0, service: 0, product: 0, visits: 0, customers: 0 };
    const old = existing.find((r) => r['養護師'] === name);
    const adj = old ? n(old['調整金額']) : 0;
    const b = monthlyBonus(s.sales + adj, params);
    const row = {
      月份: month, 養護師: name, 業績: s.sales, 服務業績: s.service, 商品業績: s.product,
      筆數: s.visits, 客數: s.customers, 客單價: s.customers ? Math.round((s.sales + adj) / s.customers) : '',
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
  const sales = n(row['業績']);
  const customers = n(row['客數']);
  const b = monthlyBonus(sales + adj, params);
  return {
    調整金額: adj,
    客單價: customers ? Math.round((sales + adj) / customers) : '',
    第一級業績: b.tier1, 第二級業績: b.tier2, 當月獎金: b.bonus,
  };
}

/** 月業績列的「有效業績」＝報表業績＋調整金額。 */
export const effectiveSales = (row) => n(row['業績']) + n(row['調整金額']);
