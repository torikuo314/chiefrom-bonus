// 季結算＋季獎金明細
import { $, $$, esc, fmt, today } from './ui.js';
import { quarterOf, monthsOfQuarter } from './calc.js';
import { buildQuarter, settlementRows } from './quarter.js';
import { capture, downloadZip, renderPreviews } from './export.js';

let ctx;
let quarter = null;
let qd = null;
let results = [];

export function init(c) {
  ctx = c;
  $('#q-sel').addEventListener('change', (e) => { quarter = e.target.value; render(); });
  $('#q-settle').addEventListener('click', settle);
  $('#q-unlock').addEventListener('click', unlock);
  $('#q-make').addEventListener('click', make);
  $('#q-zip').addEventListener('click', () => downloadZip(results, fileName, `${quarter}_季獎金明細.zip`));
}

export function show() {
  const qs = new Set([quarterOf(today().slice(0, 7))]);
  ctx.db['月業績'].forEach((r) => qs.add(quarterOf(r['月份'])));
  ctx.db['預支'].forEach((r) => r['扣抵季度'] && qs.add(r['扣抵季度']));
  ctx.db['季結算'].forEach((r) => qs.add(r['季度']));
  const list = [...qs].sort().reverse();
  if (!quarter || !list.includes(quarter)) {
    const withData = list.filter((q) => ctx.db['月業績'].some((r) => quarterOf(r['月份']) === q));
    quarter = withData[0] || list[0];
  }
  $('#q-sel').innerHTML = list.map((q) => `<option ${q === quarter ? 'selected' : ''}>${q}</option>`).join('');
  render();
}

const qLabel = (q) => {
  const [y, k] = q.split('-Q');
  const ms = monthsOfQuarter(q).map((m) => Number(m.slice(5)));
  return `${y} 年第 ${k} 季（${ms[0]}–${ms[2]} 月）`;
};
const fileName = (name, ext) => `${quarter}_${name}_季獎金明細.${ext}`;

function render() {
  qd = buildQuarter(ctx.db, quarter);
  results = [];
  $('#q-results').innerHTML = '';
  $('#q-zip').hidden = true;
  const settled = !!qd.settledAt;
  $('#q-status').innerHTML = settled
    ? `<span class="badge ${qd.locked ? 's-已確認' : 's-未確認'}">${qd.locked ? '已結算・已鎖定' : '已結算・已解鎖（可重新結算）'}</span> 結算日期 ${esc(qd.settledAt)}`
    : '<span class="badge s-未確認">尚未結算</span>';
  $('#q-blockers').innerHTML = qd.blockers.map((b) => `<li>${esc(b)}</li>`).join('');
  $('#q-blockers').hidden = !qd.blockers.length || qd.locked;
  $('#q-warnings').innerHTML = qd.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  $('#q-warnings').hidden = !qd.warnings.length || qd.locked;

  const [m1, m2, m3] = qd.months.map((m) => `${Number(m.slice(5))} 月獎金`);
  $('#q-table').innerHTML = qd.staff.length ? `
    <thead><tr><th>養護師</th><th>${m1}</th><th>${m2}</th><th>${m3}</th><th>季獎金合計</th><th>上季結轉待扣</th><th>本季預支</th><th>本季實發</th><th>結轉下季待扣</th></tr></thead>
    <tbody>${qd.staff.map((s) => {
      const v = s.saved && qd.locked ? { quarterBonus: s.saved['季獎金合計'], carryIn: s.saved['上季結轉'], advanceTotal: s.saved['本季預支'], payout: s.saved['實發金額'], carryOut: s.saved['結轉下季'] } : s;
      return `<tr><td>${esc(s.name)}</td>${s.months.map((m) => `<td>${m.noData ? '<span class="hint">—</span>' : fmt(m.bonus)}${m.confirmed ? '' : ' <span class="warn">未確認</span>'}</td>`).join('')}
        <td>${fmt(v.quarterBonus)}</td><td>${fmt(v.carryIn)}</td><td>${fmt(v.advanceTotal)}${s.advances.some((a) => !a.signed) ? ' <span class="warn">未簽</span>' : ''}</td>
        <td><b>${fmt(v.payout)}</b></td><td>${fmt(v.carryOut)}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td>合計</td><td colspan="3"></td><td>${fmt(sum('quarterBonus'))}</td><td>${fmt(sum('carryIn'))}</td><td>${fmt(sum('advanceTotal'))}</td><td>${fmt(sum('payout'))}</td><td>${fmt(sum('carryOut'))}</td></tr></tfoot>`
    : '<tbody><tr><td>本季沒有資料</td></tr></tbody>';

  $('#q-pay').value = qd.payDate;
  $('#q-pay').disabled = qd.locked;
  $('#q-settle').hidden = qd.locked;
  $('#q-settle').disabled = !!qd.blockers.length || !qd.staff.length;
  $('#q-settle').textContent = settled ? '重新結算並鎖定' : '結算並鎖定';
  $('#q-unlock').hidden = !qd.locked;
  $('#q-make').disabled = !qd.locked;
  $('#q-make-hint').textContent = qd.locked ? '' : '結算並鎖定後才能產出季獎金明細。';
}
const sum = (k) => qd.staff.reduce((a, s) => a + s[k], 0);

async function settle() {
  const payDate = $('#q-pay').value;
  if (!payDate) return alert('請填寫發放日期');
  const unsigned = qd.staff.flatMap((s) => s.advances.filter((a) => !a.signed).map((a) => `${s.name} ${a.date} ${fmt(a.amount)} 元`));
  let msg = `確定結算 ${quarter}？\n本季實發合計 ${fmt(sum('payout'))} 元，發放日期 ${payDate}。\n結算後本季資料會鎖定。`;
  if (unsigned.length) msg += `\n\n⚠ 以下預支尚未簽同意書，仍要扣抵嗎？\n${unsigned.join('\n')}`;
  if (qd.nextSettled) msg += `\n\n⚠ 下一季已經結算過，本季的「結轉下季待扣」若有變動，下一季需解鎖後重新結算。`;
  if (!confirm(msg)) return;
  const rows = settlementRows(qd, { today: today(), payDate });
  try {
    await ctx.write([{ action: 'replace', payload: { sheet: '季結算', match: { 季度: quarter }, rows } }],
      { 動作: '季結算', 內容: `${quarter}：${rows.map((r) => `${r['養護師']} 實發 ${r['實發金額']}／結轉 ${r['結轉下季']}`).join('；')}；發放日期 ${payDate}${unsigned.length ? `；未簽同意書：${unsigned.join('、')}` : ''}` });
    render();
  } catch (e) { alert('結算失敗：' + e.message); }
}

async function unlock() {
  const reason = prompt(`解鎖 ${quarter} 後可以修改該季資料並重新結算。\n請輸入解鎖原因：`);
  if (!reason) return;
  const rows = ctx.db['季結算'].filter((r) => r['季度'] === quarter).map((r) => ({ 季度: quarter, 養護師: r['養護師'], 鎖定狀態: '已解鎖' }));
  try {
    await ctx.write([{ action: 'upsert', payload: { sheet: '季結算', keys: ['季度', '養護師'], rows } }],
      { 動作: '解鎖', 內容: `${quarter}；原因：${reason}` });
    render();
  } catch (e) { alert('解鎖失敗：' + e.message); }
}

// ---------------- 季獎金明細 ----------------
async function make() {
  const btn = $('#q-make');
  btn.disabled = true;
  results = [];
  try {
    await document.fonts.ready;
    for (const [i, s] of qd.staff.entries()) {
      btn.textContent = `產生中… ${i + 1}/${qd.staff.length}`;
      const sheet = document.createElement('div');
      sheet.className = 'sheet qsheet';
      sheet.innerHTML = sheetHtml(s);
      $('#q-stage').appendChild(sheet);
      try { results.push({ name: s.name, ...(await capture(sheet)) }); } finally { sheet.remove(); }
    }
    renderPreviews($('#q-results'), results, fileName, `${quarter} 季獎金明細`);
    $('#q-zip').hidden = results.length < 2;
  } catch (e) {
    alert('產生失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '產生季獎金明細';
  }
}

const pct = (r) => `${+(r * 100).toFixed(2)}%`;

function sheetHtml(s) {
  const v = s.saved;
  const total = { quarterBonus: v['季獎金合計'], carryIn: v['上季結轉'], advanceTotal: v['本季預支'], payout: v['實發金額'], carryOut: v['結轉下季'] };
  const adjusted = s.months.some((m) => m.adjustment);
  const multi = qd.rules.length > 1;
  return `
  <header class="st-head"><div class="st-brand">頭沐 | CHIEFROM</div><div class="st-doc">季獎金明細</div></header>
  <section class="q-title">
    <h1>${esc(s.name)}</h1>
    <p>${qLabel(quarter)}<span>發放日期 ${esc(v['發放日期'])}</span></p>
  </section>

  <h2 class="q-h">各月獎金</h2>
  <table class="q-table">
    <thead><tr><th>月份</th><th>個人業績</th><th>第一級業績</th><th>第二級業績</th><th>當月獎金</th></tr></thead>
    <tbody>${s.months.map((m) => `<tr><td>${Number(m.month.slice(5))} 月</td><td>${fmt(m.sales)}${m.adjustment ? '<sup>*</sup>' : ''}</td><td>${fmt(m.tier1)}</td><td>${fmt(m.tier2)}</td><td>${fmt(m.bonus)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>季合計</td><td colspan="3"></td><td>${fmt(total.quarterBonus)}</td></tr></tfoot>
  </table>
  ${adjusted ? `<p class="q-note">* 含手動調整：${s.months.filter((m) => m.adjustment).map((m) => `${Number(m.month.slice(5))} 月 ${m.adjustment > 0 ? '+' : ''}${fmt(m.adjustment)} 元`).join('、')}</p>` : ''}

  <h2 class="q-h">本季預支</h2>
  ${s.advances.length ? `<table class="q-table">
    <thead><tr><th>日期</th><th>金額</th><th class="l">備註</th></tr></thead>
    <tbody>${s.advances.map((a) => `<tr><td>${esc(a.date)}</td><td>${fmt(a.amount)}</td><td class="l">${esc(a.note)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>合計</td><td>${fmt(total.advanceTotal)}</td><td></td></tr></tfoot>
  </table>` : '<p class="q-none">本季無預支</p>'}

  <h2 class="q-h">結算</h2>
  <dl class="q-calc">
    <div><dt>季獎金合計</dt><dd>${fmt(total.quarterBonus)}</dd></div>
    <div><dt>－ 上季結轉待扣</dt><dd>${fmt(total.carryIn)}</dd></div>
    <div><dt>－ 本季預支</dt><dd>${fmt(total.advanceTotal)}</dd></div>
    <div class="q-pay"><dt>＝ 本季實發金額</dt><dd>NT$ ${fmt(total.payout)}</dd></div>
    <div><dt>結轉下季待扣</dt><dd>${fmt(total.carryOut)}</dd></div>
  </dl>

  <section class="q-rules">
    <h2 class="q-h">計算規則</h2>
    ${qd.rules.map((r) => `<p>${multi ? `${r.months.map((m) => Number(m.slice(5))).join('、')} 月：` : ''}每月業績分段累進計算，當月業績超過 ${fmt(r.T1)} 元至 ${fmt(r.T2)} 元的部分 × ${pct(r.R1)}；超過 ${fmt(r.T2)} 元的部分 × ${pct(r.R2)}。</p>`).join('')}
    <p>本季實發金額＝季獎金合計－上季結轉待扣－本季預支；不足扣抵的部分結轉至下季扣抵。本明細為季獎金發放明細，非薪資單。</p>
  </section>

  <section class="q-sign">
    <div>養護師簽名<span></span></div>
    <div>日期<span></span></div>
  </section>
  <footer class="st-foot">頭沐 | CHIEFROM</footer>`;
}
