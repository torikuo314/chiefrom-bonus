// 上傳匯入：神美「訂單列表」（v2 §4）。可一次匯入多個月份。
import { buildResolver } from './importer.js';
import { ORDER_FIELDS, DEFAULT_ORDER_MAPPING, checkOrderMapping, parseOrders, mergeParsed, applyDecisions, orderSummary } from './orders.js';
import { orderLineToSheetRow, monthStatsFromLines, orderLinesFromSheet, buildMonthlyRows } from './monthly.js';
import { $, $$, esc, fmt } from './ui.js';

let ctx;
let files = []; // { fileName, sheet, rows }
let decisions = {}; // { 工作人員原始名稱: { assignTo } | { exclude: true } }
let chosen = null; // 要匯入的月份 Set

export function init(c) {
  ctx = c;
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles([...e.dataTransfer.files]); });
  $('#file').addEventListener('change', (e) => { const list = [...e.target.files]; e.target.value = ''; readFiles(list); });
  $('#map-save').addEventListener('click', saveMapping);
}
export function show() {
  renderFiles();
  next();
}

const mapping = () => ({ ...DEFAULT_ORDER_MAPPING, ...(ctx.settings.orderMapping || {}) });

async function readFiles(list) {
  for (const f of list) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheet = wb.SheetNames.includes('訂單列表') ? '訂單列表' : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
      files.push({ fileName: f.name, sheet, rows });
    } catch (e) {
      alert(`讀取 ${f.name} 失敗：${e.message}`);
    }
  }
  chosen = null;
  renderFiles();
  next();
}

function renderFiles() {
  $('#files').innerHTML = files.map((f, i) => `
    <div class="file-row">
      <span class="name">${esc(f.fileName)}<br><span class="hint">工作表「${esc(f.sheet)}」・${f.rows.length - 1} 列</span></span>
      <button data-rm="${i}">移除</button>
    </div>`).join('');
  $$('[data-rm]').forEach((el) => el.addEventListener('click', () => { files.splice(el.dataset.rm, 1); chosen = null; renderFiles(); next(); }));
}

const headersOf = (f) => (f.rows[0] || []).map((h) => String(h ?? '').trim());

function next() {
  $('#step-map').hidden = true;
  $('#step-preview').hidden = true;
  if (!files.length || !ctx.db) return;
  const bad = files.find((f) => !checkOrderMapping(headersOf(f), mapping()).ok);
  if (bad) return showMapping(bad);
  showPreview();
}

function showMapping(f) {
  const headers = headersOf(f).filter(Boolean);
  const m = mapping();
  $('#map-form').innerHTML = ORDER_FIELDS.map((fd) => `
    <label>${fd.label}${fd.required ? ' <span class="warn">*</span>' : ''}
      <select data-k="${fd.key}"><option value="">（不使用）</option>
        ${headers.map((h) => `<option ${m[fd.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
      </select></label>`).join('');
  $('#step-map').hidden = false;
}
async function saveMapping() {
  const m = {};
  $$('#map-form select').forEach((s) => { if (s.value) m[s.dataset.k] = s.value; });
  const missing = ORDER_FIELDS.filter((f) => f.required && !m[f.key]).map((f) => f.label);
  if (missing.length) return alert(`請對應必填欄位：${missing.join('、')}`);
  await ctx.write([{ action: 'upsert', payload: { sheet: '設定', keys: ['項目'], rows: [{ 項目: '訂單欄位對應', 值: JSON.stringify(m) }] } }],
    { 動作: '修改設定', 內容: '修改神美訂單欄位對應' });
  next();
}

function compute() {
  const resolve = buildResolver(ctx.settings.staff, ctx.settings.excluded);
  const parsed = mergeParsed(files.map((f) => parseOrders(f.rows, { mapping: mapping(), resolve, categoryMap: ctx.settings.categoryMap })));
  const applied = applyDecisions(parsed, decisions);
  return { parsed, applied, summary: orderSummary(parsed, applied) };
}

function showPreview() {
  const { parsed, applied, summary } = compute();
  const imported = new Set(ctx.db['交易明細'].map((r) => r['月份']));
  const monthInfo = summary.months.map((m) => ({
    month: m, locked: ctx.isLocked(m), exists: imported.has(m), params: !!ctx.paramsFor(m), ...summary.byMonth[m],
  }));
  if (!chosen) chosen = new Set(monthInfo.filter((x) => !x.locked && x.params).map((x) => x.month));
  const staffNames = [...new Set(applied.lines.map((l) => l.staff))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  $('#month-pick').innerHTML = `
    <p class="hint">檔案涵蓋 ${monthInfo.length} 個月份。勾選要匯入的月份；已匯入過的月份會整月覆蓋（不會重複累加）。</p>
    ${summary.duplicates ? `<p class="hint">有 ${summary.duplicates} 列在多個檔案中重複出現，已自動略過。</p>` : ''}`;
  $('#summary').innerHTML = [
    ['訂單列數', fmt(applied.lines.length + applied.pending.length)],
    ['計入業績', fmt(applied.lines.reduce((a, l) => a + l.amount, 0))],
    ['排除列數', fmt(applied.excluded.length)],
    ['待處理名稱', `${summary.pendingNames.length} 位`],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');

  $('#staff-table').innerHTML = `
    <thead><tr><th>匯入</th><th>月份</th><th>總業績</th>${staffNames.map((n) => `<th>${esc(n)}</th>`).join('')}<th>排除</th><th>狀態</th></tr></thead>
    <tbody>${monthInfo.map((x) => `<tr>
      <td><input type="checkbox" data-m="${x.month}" ${chosen.has(x.month) ? 'checked' : ''} ${x.locked || !x.params ? 'disabled' : ''}></td>
      <td>${esc(x.month)}</td><td><b>${fmt(x.total)}</b></td>
      ${staffNames.map((n) => `<td>${x.staff[n] ? fmt(x.staff[n]) : '<span class="hint">—</span>'}</td>`).join('')}
      <td>${fmt(x.excluded)}</td>
      <td>${x.locked ? '<span class="warn">該季已鎖定</span>' : !x.params ? '<span class="warn">無參數</span>' : x.exists ? '<span class="badge s-未確認">會覆蓋</span>' : '<span class="badge s-已確認">新月份</span>'}</td></tr>`).join('')}</tbody>`;
  $$('#staff-table [data-m]').forEach((el) => el.addEventListener('change', () => {
    el.checked ? chosen.add(el.dataset.m) : chosen.delete(el.dataset.m);
    showPreview();
  }));

  // 待處理（以名稱為單位）
  $('#pending-wrap').hidden = !summary.pendingNames.length && !Object.keys(decisions).length;
  const allPendingNames = [...new Set(parsed.lines.filter((l) => l.status === 'pending').map((l) => l.rawStaff))];
  $('#pending-table').innerHTML = `<thead><tr><th>工作人員（報表名稱）</th><th>列數</th><th>業績</th><th>處理方式</th></tr></thead><tbody>${
    allPendingNames.map((name) => {
      const ls = parsed.lines.filter((l) => l.rawStaff === name);
      const d = decisions[name] || {};
      const val = d.exclude ? '__ex' : d.assignTo || '';
      return `<tr><td>${esc(name)}</td><td>${ls.length}</td><td>${fmt(ls.reduce((a, l) => a + l.amount, 0))}</td>
        <td><select data-name="${esc(name)}" class="pend-sel"><option value="">— 請選擇 —</option><option value="__ex" ${val === '__ex' ? 'selected' : ''}>排除（不計入任何人）</option>
        ${ctx.settings.staff.map((p) => `<option ${val === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td></tr>`;
    }).join('')}</tbody>`;
  $$('.pend-sel').forEach((el) => el.addEventListener('change', () => {
    if (!el.value) delete decisions[el.dataset.name];
    else decisions[el.dataset.name] = el.value === '__ex' ? { exclude: true } : { assignTo: el.value };
    showPreview();
  }));

  const byReason = applied.excluded.reduce((m, e) => { (m[e.reason] ??= { n: 0, amt: 0 }); m[e.reason].n++; m[e.reason].amt += e.amount || 0; return m; }, {});
  $('#excluded-sum').textContent = `已排除 ${applied.excluded.length} 列：${Object.entries(byReason).map(([k, v]) => `${k} ${v.n} 列`).join('、') || '無'}`;
  $('#excluded-table').innerHTML = `<thead><tr><th>月份</th><th>店家</th><th>工作人員</th><th>分類</th><th>業績</th><th>原因</th></tr></thead><tbody>${
    applied.excluded.slice(0, 200).map((e) => `<tr><td>${esc(e.month)}</td><td>${esc(e.store)}</td><td>${esc(e.rawStaff || e.staff)}</td><td style="text-align:left">${esc(e.type || e.category)}</td><td>${fmt(e.amount)}</td><td>${esc(e.reason)}</td></tr>`).join('')}</tbody>`;

  const pendingInChosen = applied.pending.filter((l) => chosen.has(l.month)).length;
  const reason = !chosen.size ? '請勾選要匯入的月份' : pendingInChosen ? `還有 ${pendingInChosen} 列待處理` : '';
  $('#do-import').disabled = !!reason;
  $('#import-msg').textContent = reason;
  $('#do-import').onclick = () => doImport(applied, monthInfo);
  $('#step-preview').hidden = false;
}

async function doImport(applied, monthInfo) {
  const months = [...chosen].sort();
  const overwrite = monthInfo.filter((x) => chosen.has(x.month) && x.exists).map((x) => x.month);
  if (overwrite.length && !confirm(`${overwrite.join('、')} 已匯入過。\n按「確定」整月覆蓋，按「取消」放棄這次匯入。`)) return;
  const btn = $('#do-import');
  btn.disabled = true;
  $('#import-msg').textContent = '寫入中…（資料量大時可能需要數十秒）';
  try {
    const batchId = new Date().toISOString();
    const lines = applied.lines.filter((l) => chosen.has(l.month));
    const rows = lines.map((l) => orderLineToSheetRow(l, batchId));
    const ops = [{ action: 'importOrders', payload: { months, rows } }];
    const changedAll = [];
    for (const m of months) {
      const stats = monthStatsFromLines(lines, m);
      const existing = ctx.db['月業績'].filter((r) => r['月份'] === m);
      const { rows: monthly, changed } = buildMonthlyRows(m, stats, existing, ctx.paramsFor(m));
      if (monthly.length) ops.push({ action: 'upsert', payload: { sheet: '月業績', keys: ['月份', '養護師'], rows: monthly } });
      changedAll.push(...changed.map((n) => `${n} ${m}`));
    }
    await ctx.write(ops, {
      動作: '匯入', 內容: `神美訂單列表 ${months.join('、')}（${rows.length} 列）${overwrite.length ? `；覆蓋 ${overwrite.join('、')}` : ''}${changedAll.length ? `；業績變動改回未確認：${changedAll.join('、')}` : ''}`,
    });
    files = []; decisions = {}; chosen = null;
    renderFiles();
    $('#step-preview').hidden = false;
    $('#import-msg').innerHTML = `已匯入 ${esc(months.join('、'))}（${fmt(rows.length)} 列）。${changedAll.length ? `<span class="warn">原本已確認、業績有變動而改回未確認：${esc(changedAll.join('、'))}</span>` : ''} <a class="link" id="go-month">查看月份總覽</a>`;
    const last = months.at(-1);
    $('#go-month').addEventListener('click', () => ctx.go('month', { month: last }));
  } catch (e) {
    $('#import-msg').textContent = '匯入失敗：' + e.message;
    btn.disabled = false;
  }
}

/** 給其他畫面使用：讀出全部交易明細並轉成指標用的 row。 */
export const allOrderLines = (c) => orderLinesFromSheet(c.db['交易明細']);
