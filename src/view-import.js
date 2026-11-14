// 上傳匯入畫面
import {
  SUMMARY_FIELDS, detectMonths, checkMapping, buildResolver,
  parseSummary, aggregate, summarize, rowKey,
} from './importer.js';
import { monthlyBonus } from './calc.js';
import { linesFromSheet, lineToSheetRow, buildMonthlyRows } from './monthly.js';
import { $, $$, esc, fmt } from './ui.js';

let ctx;
let files = [];
let decisions = {};
let month = null;

export function init(c) {
  ctx = c;
}
export function show() {
  renderFiles();
  next();
}

// ---- 上傳 ----
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles([...e.dataTransfer.files]); });
$('#file').addEventListener('change', (e) => { const list = [...e.target.files]; e.target.value = ''; readFiles(list); });

async function readFiles(list) {
  for (const f of list) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheet = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
      const months = detectMonths(sheet).length ? detectMonths(sheet) : detectMonths(f.name);
      const used = new Set(files.map((x) => x.store));
      const store = ctx.settings.stores.find((s) => !used.has(s)) || ctx.settings.stores[0];
      files.push({ fileName: f.name, sheet, rows, months, store });
    } catch (e) {
      alert(`讀取 ${f.name} 失敗：${e.message}`);
    }
  }
  decisions = {};
  renderFiles();
  next();
}

function renderFiles() {
  $('#files').innerHTML = files.map((f, i) => `
    <div class="file-row">
      <span class="name">${esc(f.fileName)}<br><span class="hint">${esc(f.sheet)}・${f.rows.length - 1} 列・月份 ${f.months.join('、') || '無法判斷'}</span></span>
      <label style="margin:0">門店 <select data-i="${i}" class="store-sel">${ctx.settings.stores.map((s) => `<option ${s === f.store ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <button data-rm="${i}">移除</button>
    </div>`).join('');
  $$('.store-sel').forEach((el) => el.addEventListener('change', () => { files[el.dataset.i].store = el.value; next(); }));
  $$('[data-rm]').forEach((el) => el.addEventListener('click', () => { files.splice(el.dataset.rm, 1); renderFiles(); next(); }));
}

function next() {
  $('#step-map').hidden = true;
  $('#step-preview').hidden = true;
  if (!files.length || !ctx.db) return;
  const bad = files.find((f) => !checkMapping(headersOf(f), ctx.settings.mapping).ok);
  if (bad) return showMapping(bad);
  showPreview();
}
const headersOf = (f) => (f.rows[0] || []).map((h) => String(h ?? '').trim());

// ---- 欄位對應 ----
function showMapping(f) {
  const headers = headersOf(f).filter(Boolean);
  $('#map-form').innerHTML = SUMMARY_FIELDS.map((fd) => `
    <label>${fd.label}${fd.required ? ' <span class="warn">*</span>' : ''}
      <select data-k="${fd.key}"><option value="">（不使用）</option>
        ${headers.map((h) => `<option ${ctx.settings.mapping[fd.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
      </select></label>`).join('');
  $('#step-map').hidden = false;
}
$('#map-save').addEventListener('click', async () => {
  const m = {};
  $$('#map-form select').forEach((s) => { if (s.value) m[s.dataset.k] = s.value; });
  if (!m.staff || !m.service) return alert('「養護師」與「服務業績」為必填');
  await ctx.write([{ action: 'upsert', payload: { sheet: '設定', keys: ['項目'], rows: [{ 項目: '匯入欄位對應', 值: JSON.stringify(m) }] } }],
    { 動作: '修改設定', 內容: '修改匯入欄位對應' });
  next();
});

// ---- 預覽 ----
function showPreview() {
  const stores = files.map((f) => f.store);
  const dupStore = stores.find((s, i) => stores.indexOf(s) !== i);
  const months = [...new Set(files.flatMap((f) => f.months))].sort();
  if (!months.includes(month)) month = months.length === 1 ? months[0] : month;
  const locked = month && ctx.isLocked(month);
  const already = month ? [...new Set(ctx.db['交易明細'].filter((r) => r['月份'] === month && stores.includes(r['門店'])).map((r) => r['門店']))] : [];

  $('#month-pick').innerHTML = `
    ${dupStore ? `<p class="warn">有兩個檔案都選了「${esc(dupStore)}」，請修正門店。</p>` : ''}
    ${months.length > 1 ? `<p class="warn">檔案涵蓋多個月份（${months.join('、')}）。彙總報表無法拆分月份，請選擇要歸入哪個月：</p>` : ''}
    <label>匯入月份 <input type="month" id="month-in" value="${month || ''}"></label>
    ${locked ? `<p class="warn">${month} 所屬季度已結算鎖定，需先解鎖才能重新匯入。</p>` : ''}
    ${already.length ? `<p class="warn">${month} 的 ${already.map(esc).join('、')} 已匯入過，確認匯入時會詢問是否覆蓋。</p>` : ''}`;
  $('#month-in').addEventListener('change', (e) => { month = e.target.value; showPreview(); });

  const resolve = buildResolver(ctx.settings.staff, ctx.settings.excluded);
  const lines = files.flatMap((f) => parseSummary(f.rows, { mapping: ctx.settings.mapping, store: f.store, resolve }).lines);
  const agg = aggregate(lines, { decisions });
  const sum = summarize(lines, agg);
  let params = null;
  params = month ? ctx.paramsFor(month) : null;

  $('#summary').innerHTML = [
    ['總筆數', sum.rows],
    ['總金額（服務＋商品）', fmt(sum.total)],
    ...Object.entries(sum.byStore).map(([s, v]) => [`${s}（${v.rows} 列）`, fmt(v.amount)]),
    ['已排除', fmt(sum.excludedTotal)],
    ['待處理', `${sum.pendingCount} 筆`],
  ].map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b>${v}</b></div>`).join('');

  // 其他門店本月已匯入的資料：預覽時一起合計，試算獎金以「本月合計」計算
  const otherRows = month ? ctx.db['交易明細'].filter((r) => r['月份'] === month && !stores.includes(r['門店'])) : [];
  const otherStores = [...new Set(otherRows.map((r) => r['門店']))];
  const otherAgg = aggregate(linesFromSheet(otherRows).filter((l) => l.status !== 'excluded'));
  const otherBy = new Map(otherAgg.staff.map((s) => [s.name, s.sales]));
  const names = [...new Set([...agg.staff.map((s) => s.name), ...otherBy.keys()])];
  const cur = new Map(agg.staff.map((s) => [s.name, s]));
  const table = names.map((name) => {
    const s = cur.get(name) || { name, sales: 0, service: 0, product: 0, visits: 0, customers: 0, avgTicket: null, byStore: {} };
    return { ...s, monthTotal: s.sales + (otherBy.get(name) || 0) };
  }).sort((a, b) => b.monthTotal - a.monthTotal);
  const showTotal = otherStores.length > 0;

  $('#staff-table').innerHTML = `
    <thead><tr><th>養護師</th>${stores.map((s) => `<th>${esc(s)}</th>`).join('')}<th>本次業績</th><th>服務</th><th>商品</th><th>客次</th><th>客數</th><th>客單價</th>
      ${showTotal ? `<th>本月合計<br><span class="hint">含${otherStores.map(esc).join('、')}</span></th>` : ''}<th>試算獎金<br><span class="hint">後台用</span></th></tr></thead>
    <tbody>${table.map((s) => `<tr><td>${esc(s.name)}</td>${stores.map((st) => `<td>${fmt(s.byStore[st] || 0)}</td>`).join('')}
      <td><b>${fmt(s.sales)}</b></td><td>${fmt(s.service)}</td><td>${fmt(s.product)}</td><td>${fmt(s.visits)}</td><td>${fmt(s.customers)}</td><td>${fmt(s.avgTicket)}</td>
      ${showTotal ? `<td><b>${fmt(s.monthTotal)}</b></td>` : ''}<td>${params ? fmt(monthlyBonus(s.monthTotal, params).bonus) : '無參數'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>合計</td>${stores.map(() => '<td></td>').join('')}<td>${fmt(sum.staffTotal)}</td><td colspan="5"></td>${showTotal ? `<td>${fmt(table.reduce((a, s) => a + s.monthTotal, 0))}</td>` : ''}<td></td></tr></tfoot>`;

  const pendAll = lines.filter((l) => l.status === 'pending');
  $('#pending-wrap').hidden = !pendAll.length;
  $('#pending-table').innerHTML = `<thead><tr><th>門店／列</th><th>報表名稱</th><th>金額</th><th>處理方式</th></tr></thead><tbody>${
    pendAll.map((l) => {
      const k = rowKey(l); const d = decisions[k] || {};
      const val = d.exclude ? '__ex' : d.assignTo || '';
      return `<tr><td>${esc(l.store)} 第 ${l.rowNo} 列</td><td>${esc(l.rawName) || '<span class="warn">（空白）</span>'}</td><td>${fmt(l.amount)}</td>
        <td><select data-k="${esc(k)}" class="pend-sel"><option value="">— 請選擇 —</option><option value="__ex" ${val === '__ex' ? 'selected' : ''}>排除</option>
        ${ctx.settings.staff.map((p) => `<option ${val === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td></tr>`;
    }).join('')}</tbody>`;
  $$('.pend-sel').forEach((el) => el.addEventListener('change', () => {
    if (!el.value) delete decisions[el.dataset.k];
    else decisions[el.dataset.k] = el.value === '__ex' ? { exclude: true } : { assignTo: el.value };
    showPreview();
  }));

  $('#excluded-sum').textContent = `已排除 ${agg.excluded.length} 列（固定排除名單或手動排除），合計 ${fmt(sum.excludedTotal)}`;
  $('#excluded-table').innerHTML = agg.excluded.map((l) => `<tr><td>${esc(l.store)}</td><td>${esc(l.rawName)}</td><td>${fmt(l.amount)}</td></tr>`).join('');

  const reason = !month ? '請選擇月份' : dupStore ? '門店重複' : locked ? '該季已鎖定' : !params ? `沒有 ${month} 適用的參數` : agg.pending.length ? `還有 ${agg.pending.length} 筆待處理` : '';
  $('#do-import').disabled = !!reason;
  $('#import-msg').textContent = reason;
  $('#do-import').onclick = () => doImport(lines, params, already);
  $('#step-preview').hidden = false;
}

async function doImport(lines, params, already) {
  if (already.length && !confirm(`${month} 已匯入過：${already.join('、')}。\n按「確定」覆蓋，按「取消」放棄這次匯入。`)) return;
  const btn = $('#do-import');
  btn.disabled = true;
  $('#import-msg').textContent = '寫入中…';
  try {
    const batchId = new Date().toISOString();
    const stores = files.map((f) => f.store);
    const newRows = lines.map((l) => lineToSheetRow(l, month, batchId, decisions[rowKey(l)]));
    // 該月全部門店：其他門店沿用既有資料＋本次匯入的門店
    const keep = ctx.db['交易明細'].filter((r) => r['月份'] === month && !stores.includes(r['門店']));
    const monthLines = linesFromSheet([...keep, ...newRows]);
    const existing = ctx.db['月業績'].filter((r) => r['月份'] === month);
    const { rows: monthly, changed } = buildMonthlyRows(month, monthLines, existing, params);

    const ops = stores.map((store) => ({
      action: 'replace',
      payload: { sheet: '交易明細', match: { 月份: month, 門店: store }, rows: newRows.filter((r) => r['門店'] === store) },
    }));
    ops.push({ action: 'upsert', payload: { sheet: '月業績', keys: ['月份', '養護師'], rows: monthly } });
    const total = monthly.reduce((a, r) => a + r['業績'], 0);
    await ctx.write(ops, { 動作: '匯入', 內容: `${month} ${stores.join('、')}${already.length ? '（覆蓋）' : ''}；本月養護師業績合計 ${total}${changed.length ? `；${changed.join('、')} 業績變動，確認狀態改回未確認` : ''}` });
    $('#import-msg').textContent = `已匯入 ${month}（${stores.join('、')}）${changed.length ? `。注意：${changed.join('、')} 原本已確認，業績有變動，已改回未確認。` : ''}`;
    files = []; decisions = {};
    renderFiles();
    const m = month;
    $('#import-msg').insertAdjacentHTML('beforeend', ' <a class="link" id="go-month">查看月份總覽</a>');
    $('#go-month').addEventListener('click', () => ctx.go('month', { month: m }));
  } catch (e) {
    $('#import-msg').textContent = '匯入失敗：' + e.message;
    btn.disabled = false;
  }
}

