// 季結算＋季獎金明細
import { $, $$, esc, fmt, today } from './ui.js';
import { quarterOf, monthsOfQuarter } from './calc.js';
import { buildQuarter, settlementRows, quarterAggregate, buildReview, prevQuarter } from './quarter.js';
import { metricsOf } from './analytics.js';
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
  $('#rv2-staff').addEventListener('change', renderReviewForm);
  $('#rv2-save').addEventListener('click', saveReview);
  $('#rv2-make').addEventListener('click', makeReviews);
  $('#rv2-zip').addEventListener('click', () => downloadZip(reviewResults, reviewFile, `${quarter}_季度經營回顧.zip`));
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
  // 季度經營回顧
  const names = ctx.settings.staff.map((p) => p.name);
  const cur = $('#rv2-staff').value;
  $('#rv2-staff').innerHTML = names.map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
  reviewResults = [];
  $('#rv2-results').innerHTML = '';
  $('#rv2-zip').hidden = true;
  renderReviewForm();
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
  const keepFb = new Map(ctx.db['季結算'].filter((r) => r['季度'] === quarter).map((r) => [r['養護師'], r]));
  const rows = settlementRows(qd, { today: today(), payDate }).map((r) => ({ ...r, 主管回饋: keepFb.get(r['養護師'])?.['主管回饋'] || '', 下季目標: keepFb.get(r['養護師'])?.['下季目標'] || '' }));
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

  <footer class="st-foot">頭沐 | CHIEFROM</footer>`;
}

// ---------------- 季度經營回顧（面談用） ----------------
let reviewResults = [];
const reviewFile = (name, ext) => `${quarter}_${name}_季度經營回顧.${ext}`;
const splitNames = (v) => String(v || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);

function reviewData(name) {
  const months = monthsOfQuarter(quarter);
  const pm = monthsOfQuarter(prevQuarter(quarter));
  const cur = quarterAggregate(months.map((m) => metricsOf(ctx, name, m)));
  const prev = quarterAggregate(pm.map((m) => metricsOf(ctx, name, m)));
  const row = ctx.db['季結算'].find((r) => r['季度'] === quarter && r['養護師'] === name) || {};
  const sv = ctx.db['問卷'].filter((r) => months.includes(r['月份']) && splitNames(r['對應養護師']).includes(name));
  const quotes = sv.filter((r) => splitNames(r['季讚美勾選']).includes(name)).map((r) => r['讚美文字'] || r['第一題']).filter(Boolean);
  return { months, cur, prev, row, sv, review: buildReview({ name, quarter, cur, prev, quotes, feedback: row['主管回饋'], goals: row['下季目標'] }) };
}

function renderReviewForm() {
  const name = $('#rv2-staff').value;
  if (!name) { $('#rv2-form').hidden = true; return; }
  const { row, sv } = reviewData(name);
  $('#rv2-form').hidden = false;
  $('#rv2-feedback').value = row['主管回饋'] || '';
  $('#rv2-goals').value = row['下季目標'] || '';
  $('#rv2-quotes').innerHTML = sv.length ? sv.map((r) => `<label class="check rv2-q"><input type="checkbox" value="${esc(r['編號'])}" ${splitNames(r['季讚美勾選']).includes(name) ? 'checked' : ''}${r['負評'] === '是' ? ' disabled' : ''}>
      <span>${esc(r['讚美文字'] || r['第一題'])} <span class="hint">（${esc(r['月份'])}${r['負評'] === '是' ? '・負評' : ''}${splitNames(r['讚美勾選']).includes(name) ? '・月報已選' : ''}）</span></span></label>`).join('')
    : '<p class="hint">本季沒有提到這位養護師的問卷。</p>';
  $('#rv2-msg').textContent = '';
}

async function saveReview() {
  const name = $('#rv2-staff').value;
  const feedback = $('#rv2-feedback').value.trim();
  const goals = $('#rv2-goals').value.trim();
  const picked = new Set($$('#rv2-quotes input:checked').map((i) => i.value));
  const surveyRows = $$('#rv2-quotes input').map((i) => {
    const r = ctx.db['問卷'].find((x) => x['編號'] === i.value);
    const set = new Set(splitNames(r['季讚美勾選']));
    picked.has(i.value) ? set.add(name) : set.delete(name);
    return { 編號: i.value, 季讚美勾選: [...set].join(', ') };
  });
  const ops = [{ action: 'upsert', payload: { sheet: '季結算', keys: ['季度', '養護師'], rows: [{ 季度: quarter, 養護師: name, 主管回饋: feedback, 下季目標: goals }] } }];
  if (surveyRows.length) ops.push({ action: 'upsert', payload: { sheet: '問卷', keys: ['編號'], rows: surveyRows } });
  try {
    await ctx.write(ops, { 動作: '季度回顧', 內容: `${quarter} ${name}：更新主管回饋／下季目標；精選留言 ${picked.size} 則` });
    $('#rv2-msg').textContent = '已儲存';
  } catch (e) { alert('儲存失敗：' + e.message); }
}

async function makeReviews() {
  const btn = $('#rv2-make');
  const names = ctx.settings.staff.map((p) => p.name).filter((n) => reviewData(n).cur);
  if (!names.length) return alert('本季沒有資料');
  const missing = names.filter((n) => !reviewData(n).review.feedback);
  if (missing.length && !confirm(`${missing.join('、')} 還沒有填主管回饋，仍要產生嗎？`)) return;
  btn.disabled = true;
  reviewResults = [];
  try {
    await document.fonts.ready;
    for (const [i, name] of names.entries()) {
      btn.textContent = `產生中… ${i + 1}/${names.length}`;
      const sheet = document.createElement('div');
      sheet.className = 'sheet qrsheet';
      sheet.innerHTML = reviewHtml(reviewData(name).review);
      $('#q-stage').appendChild(sheet);
      try { reviewResults.push({ name, ...(await capture(sheet)) }); } finally { sheet.remove(); }
    }
    renderPreviews($('#rv2-results'), reviewResults, reviewFile, `${quarter} 季度經營回顧`);
    $('#rv2-zip').hidden = reviewResults.length < 2;
  } catch (e) {
    alert('產生失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '產生季度經營回顧';
  }
}

const nl2br = (t) => esc(t).replace(/\n/g, '<br>');

function reviewHtml(r) {
  const [main, ...rest] = r.items;
  return `
  <header class="st-head"><div class="st-brand">頭沐 | CHIEFROM</div><div class="st-doc">季度經營回顧</div></header>
  <section class="mr-top">
    <div class="mr-who"><h1>${esc(r.name)}</h1><p>${qLabel(r.quarter)}</p></div>
    <div class="mr-sales"><span>${main.label}</span><b><small>NT$</small> ${esc(main.value)}</b>
      ${main.diff ? `<em class="qr-diff"><span class="mr-face">${{ up: '😄', down: '😢', flat: '🙂' }[main.diff.dir]}</span>較上季${esc(main.diff.text)}</em>` : ''}</div>
  </section>

  <h2 class="q-h">本季 vs 上季</h2>
  <section class="qr-grid">
    ${rest.map((c) => `<div class="mr-card">
      <span>${c.label}</span>
      <b class="${c.pending ? 'pending' : ''}">${esc(c.value)}${c.unit && !c.pending && c.value !== '—' ? `<small> ${c.unit}</small>` : ''}</b>
      <em class="mr-diff">${c.diff ? `<span class="mr-face">${{ up: '😄', down: '😢', flat: '🙂' }[c.diff.dir]}</span>${esc(c.diff.text)}` : '&nbsp;'}</em>
      <i>上季：${esc(c.prevValue)}${c.unit && c.prevValue !== '—' ? ` ${c.unit}` : ''}</i>
    </div>`).join('')}
  </section>

  ${r.quotes.length ? `<section class="mr-praise">
    <h2>本季客人有提到你喔！</h2>
    <div class="mr-quotes">${r.quotes.map((q) => `<blockquote><i>“</i>${esc(q.length > 60 ? q.slice(0, 58) + '…' : q)}</blockquote>`).join('')}</div>
  </section>` : ''}

  <section class="qr-box">
    <h2>主管回饋</h2>
    <p>${r.feedback ? nl2br(r.feedback) : '<span class="qr-empty">（面談時填寫）</span>'}</p>
  </section>
  <section class="qr-box qr-goal">
    <h2>下季目標</h2>
    <p>${r.goals ? nl2br(r.goals) : '<span class="qr-empty">（面談時填寫）</span>'}</p>
  </section>
  <footer class="st-foot">頭沐 | CHIEFROM</footer>`;
}
