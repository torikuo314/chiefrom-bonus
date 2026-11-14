// 預支管理
import { $, $$, esc, fmt, num, today } from './ui.js';
import { quarterOf } from './calc.js';

let filter = '';

export function init(ctx) {
  $('#a-add').addEventListener('click', () => add(ctx));
  $('#a-filter').addEventListener('change', (e) => { filter = e.target.value; render(ctx); });
}

export function show(ctx) {
  $('#a-date').value ||= today();
  $('#a-staff').innerHTML = ctx.settings.staff.map((p) => `<option>${esc(p.name)}</option>`).join('');
  render(ctx);
}

const settled = (ctx, q, name) => ctx.db['季結算'].some((s) => s['季度'] === q && s['養護師'] === name && s['鎖定狀態'] === '已鎖定');

function render(ctx) {
  const all = [...ctx.db['預支']].sort((a, b) => (a['日期'] < b['日期'] ? 1 : -1));
  const quarters = [...new Set(all.map((r) => r['扣抵季度']).filter(Boolean))].sort().reverse();
  $('#a-filter').innerHTML = `<option value="">全部</option><option value="__unsigned" ${filter === '__unsigned' ? 'selected' : ''}>未簽同意書</option>${
    quarters.map((q) => `<option ${filter === q ? 'selected' : ''}>${esc(q)}</option>`).join('')}`;
  const rows = all.filter((r) => !filter || (filter === '__unsigned' ? r['已簽同意書'] !== '是' : r['扣抵季度'] === filter));
  const unsigned = all.filter((r) => r['已簽同意書'] !== '是');
  $('#a-warn').hidden = !unsigned.length;
  $('#a-warn').textContent = `有 ${unsigned.length} 筆預支尚未簽同意書（${[...new Set(unsigned.map((r) => r['養護師']))].join('、')}），季結算扣抵前請補簽。`;
  const total = rows.reduce((a, r) => a + num(r['金額']), 0);
  $('#a-table').innerHTML = `<thead><tr><th>日期</th><th>養護師</th><th>金額</th><th>備註</th><th>同意書</th><th>扣抵季度</th><th></th></tr></thead>
    <tbody>${rows.map((r) => {
      const done = settled(ctx, r['扣抵季度'], r['養護師']);
      const signed = r['已簽同意書'] === '是';
      return `<tr class="${signed ? '' : 'unsigned'}"><td>${esc(r['日期'])}</td><td>${esc(r['養護師'])}</td><td>${fmt(r['金額'])}</td>
        <td style="text-align:left">${esc(r['備註'])}</td><td>${signed ? '已簽' : '<b>未簽</b>'}</td><td>${esc(r['扣抵季度'])}${done ? ' <span class="hint">已鎖定</span>' : ''}</td>
        <td>${done ? '' : `${signed ? '' : `<button class="mini" data-sign="${esc(r['編號'])}">標記已簽</button> `}<button class="mini" data-del="${esc(r['編號'])}">刪除</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan="7">沒有紀錄</td></tr>'}</tbody>
    <tfoot><tr><td>合計</td><td></td><td>${fmt(total)}</td><td colspan="4"></td></tr></tfoot>`;
  $$('[data-sign]').forEach((b) => b.addEventListener('click', () => sign(ctx, b.dataset.sign)));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => del(ctx, b.dataset.del)));
}

async function add(ctx) {
  const date = $('#a-date').value;
  const name = $('#a-staff').value;
  const amount = Math.round(num($('#a-amount').value));
  const note = $('#a-note').value.trim();
  const signed = $('#a-signed').checked;
  if (!date || !name || amount <= 0) return alert('請填寫日期、養護師與金額');
  const q = quarterOf(date.slice(0, 7));
  if (settled(ctx, q, name)) return alert(`${name} 的 ${q} 已結算鎖定，請先解鎖或改用下一季的日期`);
  const row = { 編號: `A${Date.now()}`, 日期: date, 養護師: name, 金額: amount, 備註: note, 已簽同意書: signed ? '是' : '否', 扣抵季度: q };
  try {
    await ctx.write([{ action: 'append', payload: { sheet: '預支', rows: [row] } }],
      { 動作: '新增預支', 內容: `${date} ${name} ${amount}（${q} 扣抵）${signed ? '' : '，未簽同意書'}${note ? `；${note}` : ''}` });
    $('#a-amount').value = ''; $('#a-note').value = ''; $('#a-signed').checked = false;
    render(ctx);
  } catch (e) { alert('新增失敗：' + e.message); }
}

async function sign(ctx, id) {
  const r = ctx.db['預支'].find((x) => x['編號'] === id);
  if (!confirm(`確認 ${r['養護師']} ${r['日期']} 預支 ${fmt(r['金額'])} 已簽同意書？`)) return;
  await ctx.write([{ action: 'upsert', payload: { sheet: '預支', keys: ['編號'], rows: [{ 編號: id, 已簽同意書: '是' }] } }],
    { 動作: '修改預支', 內容: `${r['日期']} ${r['養護師']} ${r['金額']} 標記已簽同意書` });
  render(ctx);
}

async function del(ctx, id) {
  const r = ctx.db['預支'].find((x) => x['編號'] === id);
  const reason = prompt(`刪除 ${r['養護師']} ${r['日期']} 預支 ${fmt(r['金額'])}？請輸入刪除原因：`);
  if (!reason) return;
  await ctx.write([{ action: 'replace', payload: { sheet: '預支', match: { 編號: id }, rows: [] } }],
    { 動作: '刪除預支', 內容: `${r['日期']} ${r['養護師']} ${r['金額']}；原因：${reason}` });
  render(ctx);
}
