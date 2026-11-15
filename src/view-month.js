// 月份總覽＋養護師月詳情（調整、確認）
import { $, $$, esc, fmt, num, today, thisMonth } from './ui.js';
import { recalcWithAdjustment, effectiveSales } from './monthly.js';

let month = null;
let current = null; // 詳情中的養護師

const latestMonth = (ctx) => ctx.db['月業績'].map((r) => r['月份']).sort().at(-1) || thisMonth();
const rowOf = (ctx, m, name) => ctx.db['月業績'].find((r) => r['月份'] === m && r['養護師'] === name);

export function init(ctx) {
  $('#m-month').addEventListener('change', (e) => { month = e.target.value; renderOverview(ctx); });
  $('#d-back').addEventListener('click', () => ctx.go('month'));
  $('#d-adj-save').addEventListener('click', () => saveAdjustment(ctx));
  $('#d-status-save').addEventListener('click', () => saveStatus(ctx));
  $('#d-status').addEventListener('change', () => {
    if ($('#d-status').value === '已確認' && !$('#d-date').value) $('#d-date').value = today();
  });
}

export function show(ctx, arg = {}) {
  if (arg.month) month = arg.month;
  if (!month) month = latestMonth(ctx);
  if (arg.detail) { current = arg.detail; return renderDetail(ctx); }
  renderOverview(ctx);
}

function renderOverview(ctx) {
  $('#m-month').value = month;
  const rows = ctx.db['月業績'].filter((r) => r['月份'] === month);
  const locked = ctx.isLocked(month);
  $('#m-lock').hidden = !locked;
  $('#m-lock').textContent = '此月所屬季度已結算鎖定，只能檢視。';
  const count = (s) => rows.filter((r) => (r['確認狀態'] || '未確認') === s).length;
  const total = rows.reduce((a, r) => a + effectiveSales(r), 0);
  const bonus = rows.reduce((a, r) => a + num(r['當月獎金']), 0);
  $('#m-stats').innerHTML = rows.length ? [
    ['養護師業績合計', fmt(total)], ['試算獎金合計（後台）', fmt(bonus)],
    ['已確認', `${count('已確認')} / ${rows.length}`], ['未確認', count('未確認')], ['有異議', count('有異議')],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('') : '';

  if (!rows.length) {
    $('#m-table').innerHTML = `<tbody><tr><td>${esc(month)} 尚未匯入資料。<a class="link" id="m-go-import">前往上傳匯入</a></td></tr></tbody>`;
    $('#m-go-import').addEventListener('click', () => ctx.go('import'));
    return;
  }
  const active = new Set(ctx.settings.staff.map((p) => p.name));
  const sorted = [...rows].sort((a, b) => effectiveSales(b) - effectiveSales(a));
  $('#m-table').innerHTML = `
    <thead><tr><th>養護師</th><th>業績</th><th>調整</th><th>客次</th><th>客數</th><th>客單價</th><th>試算獎金</th><th>確認狀態</th><th>確認方式／日期</th></tr></thead>
    <tbody>${sorted.map((r) => `<tr>
      <td><a class="link" data-name="${esc(r['養護師'])}">${esc(r['養護師'])}</a>${active.has(r['養護師']) ? '' : ` <span class="badge s-有異議">不在名單</span> <button class="mini" data-del="${esc(r['養護師'])}">刪除</button>`}</td>
      <td><b>${fmt(effectiveSales(r))}</b></td><td>${num(r['調整金額']) ? fmt(r['調整金額']) : ''}</td>
      <td>${fmt(r['筆數'])}</td><td>${fmt(r['客數'])}</td><td>${fmt(r['客單價'])}</td><td>${fmt(r['當月獎金'])}</td>
      <td><span class="badge s-${esc(r['確認狀態'] || '未確認')}">${esc(r['確認狀態'] || '未確認')}</span></td>
      <td>${esc([r['確認方式'], r['確認日期']].filter(Boolean).join(' '))}</td></tr>`).join('')}</tbody>`;
  $$('#m-table [data-name]').forEach((a) => a.addEventListener('click', () => ctx.go('detail', a.dataset.name)));
  $$('#m-table [data-del]').forEach((b) => b.addEventListener('click', () => removeMonthly(ctx, b.dataset.del)));
}

function renderDetail(ctx) {
  const r = rowOf(ctx, month, current);
  if (!r) return ctx.go('month');
  const locked = ctx.isLocked(month);
  $('#d-title').textContent = `${current}・${month}`;
  $('#d-lock').hidden = !locked;
  $('#d-lock').textContent = '此月所屬季度已結算鎖定，不能修改。如需修改請到季結算頁解鎖。';
  const adj = num(r['調整金額']);
  $('#d-stats').innerHTML = [
    ['報表業績', fmt(r['業績'])], ['手動調整', adj ? fmt(adj) : '0'], ['計算用業績', fmt(effectiveSales(r))],
    ['服務／商品', `${fmt(r['服務業績'])}／${fmt(r['商品業績'])}`], ['客次／客數', `${fmt(r['筆數'])}／${fmt(r['客數'])}`],
    ['第一級業績', fmt(r['第一級業績'])], ['第二級業績', fmt(r['第二級業績'])], ['試算獎金（後台）', fmt(r['當月獎金'])],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');

  // 業績組成：依店家 × 職位 × 類別彙總神美訂單明細
  const lines = ctx.db['交易明細'].filter((l) => l['月份'] === month && l['工作人員'] === current);
  const groups = new Map();
  for (const l of lines) {
    const k = `${l['店家']}|${l['職位']}|${l['類別']}`;
    if (!groups.has(k)) groups.set(k, { store: l['店家'], role: l['職位'], type: l['類別'], rows: 0, orders: new Set(), amount: 0 });
    const g = groups.get(k);
    g.rows++; g.orders.add(l['訂單號碼']); g.amount += num(l['業績']);
  }
  const gs = [...groups.values()].sort((a, b) => a.store.localeCompare(b.store) || a.role.localeCompare(b.role) || b.amount - a.amount);
  $('#d-lines').innerHTML = gs.length ? `<thead><tr><th>店家</th><th>職位</th><th>類別</th><th>訂單數</th><th>品項數</th><th>業績</th></tr></thead>
    <tbody>${gs.map((g) => `<tr><td>${esc(g.store)}</td><td>${esc(g.role)}</td><td class="l">${esc(g.type)}</td><td>${g.orders.size}</td><td>${g.rows}</td><td>${fmt(g.amount)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>合計</td><td colspan="4"></td><td>${fmt(gs.reduce((a, g) => a + g.amount, 0))}</td></tr></tfoot>`
    : '<tbody><tr><td class="hint">沒有訂單明細（可能是舊版彙總報表匯入的月份）</td></tr></tbody>';

  $('#d-adj').value = adj || '';
  $('#d-adj-reason').value = '';
  $('#d-status').value = r['確認狀態'] || '未確認';
  $('#d-method').value = r['確認方式'] || '';
  $('#d-date').value = r['確認日期'] || '';
  $('#d-note').value = r['備註'] || '';
  $$('#view-detail input, #view-detail select, #view-detail button').forEach((el) => (el.disabled = locked));
}

async function saveAdjustment(ctx) {
  const r = rowOf(ctx, month, current);
  const adj = Math.round(num($('#d-adj').value));
  const reason = $('#d-adj-reason').value.trim();
  const old = num(r['調整金額']);
  if (adj === old) return alert('調整金額沒有變動');
  if (!reason) return alert('請填寫調整原因');
  const params = ctx.paramsFor(month);
  if (!params) return alert(`沒有 ${month} 適用的參數`);
  const fields = recalcWithAdjustment(r, adj, params);
  const wasConfirmed = r['確認狀態'] === '已確認';
  const prevReason = r['調整原因'] ? `${r['調整原因']}；` : '';
  const row = { 月份: month, 養護師: current, ...fields, 調整原因: `${prevReason}${today()} ${fmt(old)}→${fmt(adj)}：${reason}` };
  if (wasConfirmed) Object.assign(row, { 確認狀態: '未確認', 確認日期: '', 確認方式: '' });
  try {
    await ctx.write([{ action: 'upsert', payload: { sheet: '月業績', keys: ['月份', '養護師'], rows: [row] } }],
      { 動作: '手動調整', 內容: `${month} ${current} 調整金額 ${old}→${adj}；原因：${reason}${wasConfirmed ? '；原已確認，改回未確認' : ''}` });
    if (wasConfirmed) alert('業績已變動，確認狀態已改回「未確認」，請重新請養護師確認。');
    renderDetail(ctx);
  } catch (e) { alert('儲存失敗：' + e.message); }
}

async function saveStatus(ctx) {
  const status = $('#d-status').value;
  const method = $('#d-method').value;
  const date = $('#d-date').value;
  const note = $('#d-note').value.trim();
  if (status === '已確認' && (!method || !date)) return alert('標記「已確認」時，請選擇確認方式與日期');
  if (status === '有異議' && !note) return alert('請在備註寫下異議內容');
  const row = { 月份: month, 養護師: current, 確認狀態: status, 確認方式: status === '未確認' ? '' : method, 確認日期: status === '未確認' ? '' : date, 備註: note };
  try {
    await ctx.write([{ action: 'upsert', payload: { sheet: '月業績', keys: ['月份', '養護師'], rows: [row] } }],
      { 動作: '確認', 內容: `${month} ${current}：${status}${method ? `（${method} ${date}）` : ''}${note ? `；備註：${note}` : ''}` });
    ctx.go('month');
  } catch (e) { alert('儲存失敗：' + e.message); }
}

/** 參數變更後，重算 fromMonth 起（未鎖定）各月的獎金。 */
export async function recalcFrom(ctx, fromMonth) {
  const rows = ctx.db['月業績'].filter((r) => r['月份'] >= fromMonth && !ctx.isLocked(r['月份']));
  const updates = rows.map((r) => {
    const p = ctx.paramsFor(r['月份']);
    return p ? { 月份: r['月份'], 養護師: r['養護師'], ...recalcWithAdjustment(r, num(r['調整金額']), p) } : null;
  }).filter(Boolean);
  if (!updates.length) return;
  await ctx.write([{ action: 'upsert', payload: { sheet: '月業績', keys: ['月份', '養護師'], rows: updates } }],
    { 動作: '重算獎金', 內容: `參數變更，重算 ${fromMonth} 起 ${updates.length} 筆月業績` });
}

/** 移除不在名單上的人（例如改名前的舊名字）的月業績。 */
async function removeMonthly(ctx, name) {
  if (ctx.isLocked(month)) return alert('此月所屬季度已結算鎖定，請先解鎖。');
  const months = [...new Set(ctx.db['月業績'].filter((r) => r['養護師'] === name).map((r) => r['月份']))].sort();
  const all = months.length > 1 && confirm(`「${name}」在 ${months.join('、')} 都有資料。\n按「確定」刪除全部月份，按「取消」只刪除 ${month}。`);
  const targets = (all ? months : [month]).filter((m) => !ctx.isLocked(m));
  if (!confirm(`確定刪除「${name}」${targets.join('、')} 的月業績？（交易明細不受影響）`)) return;
  try {
    await ctx.write(targets.map((m) => ({ action: 'replace', payload: { sheet: '月業績', match: { 月份: m, 養護師: name }, rows: [] } })),
      { 動作: '刪除月業績', 內容: `${name}：${targets.join('、')}（不在名單）` });
    const skipped = (all ? months : [month]).filter((m) => ctx.isLocked(m));
    if (skipped.length) alert(`${skipped.join('、')} 所屬季度已結算鎖定，這幾個月沒有刪除。如需刪除請先到季結算解鎖。`);
    renderOverview(ctx);
  } catch (e) { alert('刪除失敗：' + e.message); }
}
