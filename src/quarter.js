// 季結算資料整理。純函式。
import { monthsOfQuarter, quarterSettlement } from './calc.js';
import { effectiveSales, paramVersions } from './monthly.js';
import { paramsForMonth } from './calc.js';

const n = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')) || 0);

export function prevQuarter(q) {
  let [y, k] = q.split('-Q').map(Number);
  if (--k < 1) { k = 4; y--; }
  return `${y}-Q${k}`;
}
export function nextQuarter(q) {
  let [y, k] = q.split('-Q').map(Number);
  if (++k > 4) { k = 1; y++; }
  return `${y}-Q${k}`;
}

/** 預設發放日期：季末次月 15 日。 */
export function defaultPayDate(q) {
  const last = monthsOfQuarter(q)[2];
  let [y, m] = last.split('-').map(Number);
  if (++m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}-15`;
}

/**
 * 整理某季的結算預覽。
 * db：{ 月業績, 預支, 季結算, 參數 }（皆為字串列）
 * 回傳 { quarter, months, blockers, warnings, staff: [...] }
 */
export function buildQuarter(db, q) {
  const months = monthsOfQuarter(q);
  const prevQ = prevQuarter(q);
  const monthly = db['月業績'].filter((r) => months.includes(r['月份']));
  const advances = db['預支'].filter((r) => r['扣抵季度'] === q);
  const prevSettle = db['季結算'].filter((r) => r['季度'] === prevQ);
  const settled = db['季結算'].filter((r) => r['季度'] === q);

  const names = [...new Set([
    ...monthly.map((r) => r['養護師']),
    ...advances.map((r) => r['養護師']),
    ...prevSettle.filter((r) => n(r['結轉下季']) > 0).map((r) => r['養護師']),
  ])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  const blockers = [];
  const warnings = [];
  const missingMonths = months.filter((m) => !db['月業績'].some((r) => r['月份'] === m));
  if (missingMonths.length) blockers.push(`尚未匯入：${missingMonths.join('、')}`);
  const unconfirmed = monthly.filter((r) => r['確認狀態'] !== '已確認');
  if (unconfirmed.length) blockers.push(`尚未確認：${unconfirmed.map((r) => `${r['養護師']} ${r['月份']}（${r['確認狀態'] || '未確認'}）`).join('、')}`);
  const prevHasData = db['月業績'].some((r) => monthsOfQuarter(prevQ).includes(r['月份'])) || db['預支'].some((r) => r['扣抵季度'] === prevQ);
  if (prevHasData && !prevSettle.some((r) => r['結算日期'])) warnings.push(`上一季 ${prevQ} 尚未結算，上季結轉待扣以 0 計算`);
  const unsigned = advances.filter((r) => r['已簽同意書'] !== '是');
  if (unsigned.length) warnings.push(`未簽同意書的預支：${unsigned.map((r) => `${r['養護師']} ${r['日期']} ${n(r['金額']).toLocaleString('en-US')} 元`).join('、')}`);

  const staff = names.map((name) => {
    const rows = months.map((m) => {
      const r = monthly.find((x) => x['月份'] === m && x['養護師'] === name);
      return r
        ? { month: m, sales: effectiveSales(r), adjustment: n(r['調整金額']), tier1: n(r['第一級業績']), tier2: n(r['第二級業績']), bonus: n(r['當月獎金']), confirmed: r['確認狀態'] === '已確認' }
        : { month: m, sales: 0, adjustment: 0, tier1: 0, tier2: 0, bonus: 0, confirmed: true, noData: true };
    });
    const adv = advances.filter((r) => r['養護師'] === name).map((r) => ({
      id: r['編號'], date: r['日期'], amount: n(r['金額']), note: r['備註'], signed: r['已簽同意書'] === '是',
    })).sort((a, b) => (a.date < b.date ? -1 : 1));
    const carryIn = n(prevSettle.find((r) => r['養護師'] === name)?.['結轉下季']);
    let result = null;
    try {
      result = quarterSettlement({ months: rows, carryIn, advances: adv });
    } catch { /* 有未確認月份：預覽仍顯示加總，但不能結算 */
      result = quarterSettlement({ months: rows.map((x) => ({ ...x, confirmed: true })), carryIn, advances: adv });
    }
    const saved = settled.find((r) => r['養護師'] === name) || null;
    return { name, months: rows, advances: adv, carryIn, ...result, saved };
  });

  const lockedRows = settled.filter((r) => r['鎖定狀態'] === '已鎖定');
  return {
    quarter: q, months, blockers, warnings, staff,
    locked: lockedRows.length > 0,
    settledAt: settled.find((r) => r['結算日期'])?.['結算日期'] || '',
    payDate: settled.find((r) => r['發放日期'])?.['發放日期'] || defaultPayDate(q),
    nextSettled: db['季結算'].some((r) => r['季度'] === nextQuarter(q) && r['結算日期']),
    rules: quarterRules(db['參數'], months),
  };
}

/** 本季適用的參數（各月可能不同）。 */
export function quarterRules(paramRows, months) {
  const versions = paramVersions(paramRows);
  const out = [];
  for (const m of months) {
    let p;
    try { p = paramsForMonth(versions, m); } catch { continue; }
    const last = out.at(-1);
    if (last && last.T1 === p.T1 && last.T2 === p.T2 && last.R1 === p.R1 && last.R2 === p.R2) last.months.push(m);
    else out.push({ months: [m], T1: p.T1, T2: p.T2, R1: p.R1, R2: p.R2 });
  }
  return out;
}

/** 轉成季結算分頁的列。 */
export function settlementRows(qd, { today, payDate }) {
  return qd.staff.map((s) => ({
    季度: qd.quarter, 養護師: s.name, 季獎金合計: s.quarterBonus, 上季結轉: s.carryIn, 本季預支: s.advanceTotal,
    實發金額: s.payout, 結轉下季: s.carryOut, 結算日期: today, 發放日期: payDate, 鎖定狀態: '已鎖定',
  }));
}
