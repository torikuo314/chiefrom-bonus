// 主程式：共用狀態、分頁切換、設定頁。
import { $, $$, esc, fmt, split, num } from './ui.js';
import { ORDER_FIELDS, DEFAULT_ORDER_MAPPING } from './orders.js';
import { DEFAULT_CATEGORY_MAP, DEFAULT_METRIC_SETTINGS } from './metrics.js';
import { DEFAULT_ENV_KEYWORDS, DEFAULT_ANONYMOUS } from './survey.js';
import { createBackend, getConnection, setConnection } from './backend.js';
import { paramVersions, paramsFor, isQuarterLocked } from './monthly.js';
import { validateParams } from './calc.js';
import * as importView from './view-import.js';
import * as monthView from './view-month.js';
import * as advanceView from './view-advance.js';
import * as statementView from './view-statement.js';
import * as quarterView from './view-quarter.js';
import * as surveyView from './view-survey.js';

const SHEETS = ['養護師', '設定', '參數', '月業績', '季結算', '交易明細', '預支', '問卷'];

export const ctx = {
  backend: createBackend(),
  db: null,
  settings: { stores: [], excluded: [], orderMapping: DEFAULT_ORDER_MAPPING, staff: [], allStaff: [] },
  view: null,

  async reload() {
    ctx.db = await ctx.backend.call('read', { sheets: SHEETS });
    const kv = Object.fromEntries(ctx.db['設定'].map((r) => [r['項目'], r['值']]));
    const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
    const allStaff = ctx.db['養護師'].map((r) => ({
      name: r['姓名'], aliases: split(r['別名']), nicknames: split(r['暱稱']), store: r['所屬門店'],
      active: r['在職狀態'] !== '離職', compare: r['納入比較'] !== '否',
    }));
    ctx.settings = {
      stores: parse(kv['門店'], []),
      excluded: parse(kv['固定排除'], []),
      orderMapping: parse(kv['訂單欄位對應'], DEFAULT_ORDER_MAPPING),
      surveyMapping: parse(kv['問卷欄位對應'], null),
      categoryMap: parse(kv['類別對照'], DEFAULT_CATEGORY_MAP),
      envKeywords: parse(kv['環境類關鍵字'], DEFAULT_ENV_KEYWORDS),
      anonymous: parse(kv['未指名用語'], DEFAULT_ANONYMOUS),
      metric: { ...DEFAULT_METRIC_SETTINGS, ...parse(kv['指標設定'], {}) },
      staff: allStaff.filter((p) => p.active),
      allStaff,
    };
  },
  /** 一次寫入多個操作＋操作紀錄，完成後重新讀取。 */
  async write(ops, log) {
    await ctx.backend.call('batch', { ops, log });
    await ctx.reload();
  },
  paramsFor(month) {
    try { return paramsFor(ctx.db['參數'], month); } catch { return null; }
  },
  isLocked: (month) => isQuarterLocked(ctx.db['季結算'], month),
  go(view, arg) {
    ctx.view = view;
    $$('.view').forEach((el) => (el.hidden = el.id !== `view-${view}`));
    $$('#nav a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view || (view === 'detail' && a.dataset.view === 'month')));
    ({ month: monthView, detail: monthView, import: importView, survey: surveyView, advance: advanceView, statement: statementView, quarter: quarterView, settings: settingsView }[view])
      .show(ctx, view === 'detail' ? { detail: arg } : arg);
    window.scrollTo(0, 0);
  },
};

function status(msg, warn) {
  $('#conn-status').textContent = msg;
  $('#conn-status').className = warn ? 'hint warn' : 'hint';
}

async function start() {
  status('讀取中…');
  try {
    try { await ctx.reload(); } catch (e) {
      if (/不允許的分頁/.test(e.message)) throw new Error('Google Apps Script 程式還是舊版，請依 DEPLOY.md「更新 Code.gs」重新貼上並部署新版本');
      if (!/初始化/.test(e.message)) throw e;
      await ctx.backend.call('init');
      await ctx.reload();
    }
    status(ctx.backend.mode === 'sheets' ? '已連線 Google Sheets' : '本機測試模式：資料只存在此瀏覽器，尚未連線 Google Sheets', ctx.backend.mode !== 'sheets');
    ctx.go(ctx.settings.staff.length ? (ctx.view && ctx.view !== 'detail' ? ctx.view : 'month') : 'settings');
  } catch (e) {
    status('讀取失敗：' + e.message, true);
    ctx.go('settings');
  }
}

$$('#nav a[data-view]').forEach((a) => a.addEventListener('click', () => ctx.db && ctx.go(a.dataset.view)));
[importView, surveyView, monthView, advanceView, statementView, quarterView].forEach((v) => v.init?.(ctx));

// ---------------- 設定頁 ----------------
const settingsView = {
  show(c) {
    const conn = getConnection() || {};
    $('#set-url').value = conn.url || '';
    $('#set-token').value = conn.token || '';
    if (!c.db) return;
    $('#set-stores').value = c.settings.stores.join(', ');
    renderStaffEditor(c.settings.staff);
    $('#set-excluded').value = c.settings.excluded.join(', ');
    $('#set-env').value = c.settings.envKeywords.join(', ');
    renderParams();
    $('#map-table').innerHTML = `<thead><tr><th>系統欄位</th><th>神美欄位</th></tr></thead><tbody>${
      ORDER_FIELDS.map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(c.settings.orderMapping[f.key] || '（不使用）')}</td></tr>`).join('')}</tbody>`;
  },
};

// 養護師名單編輯表：顯示名稱、別名（神美工作人員名稱）、暱稱（問卷用）、納入比較
function renderStaffEditor(staff) {
  const rows = staff.length ? staff : [{ name: '', aliases: [], nicknames: [], compare: true }];
  $('#staff-editor').innerHTML = `<thead><tr><th>顯示名稱</th><th>神美上的名稱（別名）</th><th>問卷暱稱</th><th>納入比較</th><th></th></tr></thead><tbody>${
    rows.map((p) => staffRow(p)).join('')}</tbody>`;
  bindStaffRows();
}
const staffRow = (p) => `<tr>
  <td><input class="se-name" value="${esc(p.name)}" placeholder="例：小美"></td>
  <td><input class="se-alias" value="${esc(p.aliases.join(', '))}" placeholder="神美上的名字"></td>
  <td><input class="se-nick" value="${esc(p.nicknames.join(', '))}" placeholder="客人可能寫的暱稱"></td>
  <td><input type="checkbox" class="se-cmp" ${p.compare ? 'checked' : ''}></td>
  <td><button class="mini se-del">刪除</button></td></tr>`;
function bindStaffRows() {
  $$('.se-del').forEach((b) => { b.onclick = () => b.closest('tr').replaceWith(); });
}
$('#staff-add').addEventListener('click', () => {
  $('#staff-editor tbody').insertAdjacentHTML('beforeend', staffRow({ name: '', aliases: [], nicknames: [], compare: true }));
  bindStaffRows();
});

function renderParams() {
  const versions = paramVersions(ctx.db['參數']);
  $('#p-table').innerHTML = `<thead><tr><th>生效月份</th><th>T1</th><th>T2</th><th>R1</th><th>R2</th></tr></thead><tbody>${
    versions.map((v) => `<tr><td>${esc(v.effectiveMonth)}</td><td>${fmt(v.T1)}</td><td>${fmt(v.T2)}</td><td>${+(v.R1 * 100).toFixed(2)}%</td><td>${+(v.R2 * 100).toFixed(2)}%</td></tr>`).join('')}</tbody>`;
  const last = versions.at(-1);
  if (last) {
    $('#p-T1').value = last.T1; $('#p-T2').value = last.T2;
    $('#p-R1').value = +(last.R1 * 100).toFixed(2); $('#p-R2').value = +(last.R2 * 100).toFixed(2);
  }
}

$('#conn-save').addEventListener('click', async () => {
  const url = $('#set-url').value.trim();
  const token = $('#set-token').value.trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return alert('網址格式應為 https://script.google.com/macros/s/…/exec');
  if (url && token.length < 16) return alert('請貼上 token（執行 setupToken 後在執行記錄中取得）');
  setConnection(url ? { url, token } : null);
  ctx.backend = createBackend();
  try {
    const r = await ctx.backend.call('ping');
    const init = await ctx.backend.call('init');
    alert(`連線成功：${r.name}${init.created.length ? `\n已建立分頁：${init.created.join('、')}` : ''}`);
  } catch (e) {
    alert('連線失敗：' + e.message);
  }
  ctx.view = 'settings';
  start();
});

$('#set-save').addEventListener('click', async () => {
  const stores = split($('#set-stores').value);
  const excluded = split($('#set-excluded').value);
  const envKeywords = split($('#set-env').value);
  const staff = $$('#staff-editor tbody tr').map((tr) => ({
    name: tr.querySelector('.se-name').value.trim(), aliases: split(tr.querySelector('.se-alias').value),
    nicknames: split(tr.querySelector('.se-nick').value), compare: tr.querySelector('.se-cmp').checked,
  })).filter((p) => p.name);
  if (!stores.length) return alert('至少要有一家門店');
  const names = new Set(staff.map((p) => p.name));
  if (names.size !== staff.length) return alert('顯示名稱不可重複');
  const rows = [
    ...staff.map((p) => ({ 姓名: p.name, 別名: p.aliases.join(', '), 暱稱: p.nicknames.join(', '), 納入比較: p.compare ? '是' : '否', 在職狀態: '在職' })),
    ...ctx.db['養護師'].filter((r) => !names.has(r['姓名']) && r['在職狀態'] !== '離職').map((r) => ({ 姓名: r['姓名'], 在職狀態: '離職' })),
  ];
  try {
    await ctx.write([
      { action: 'upsert', payload: { sheet: '養護師', keys: ['姓名'], rows } },
      { action: 'upsert', payload: { sheet: '設定', keys: ['項目'], rows: [{ 項目: '門店', 值: JSON.stringify(stores) }, { 項目: '固定排除', 值: JSON.stringify(excluded) }, { 項目: '環境類關鍵字', 值: JSON.stringify(envKeywords) }] } },
    ], { 動作: '修改設定', 內容: `養護師：${[...names].join('、')}；固定排除：${excluded.join('、')}；門店：${stores.join('、')}` });
    alert('已儲存');
    settingsView.show(ctx);
  } catch (e) { alert('儲存失敗：' + e.message); }
});

$('#p-add').addEventListener('click', async () => {
  const month = $('#p-month').value;
  const p = { T1: num($('#p-T1').value), T2: num($('#p-T2').value), R1: num($('#p-R1').value) / 100, R2: num($('#p-R2').value) / 100 };
  if (!month) return alert('請選擇生效月份');
  try { validateParams(p); } catch (e) { return alert(e.message); }
  if (p.R1 > 1 || p.R2 > 1) return alert('比例請填百分比，例如 20');
  const lockedMonths = ctx.db['月業績'].map((r) => r['月份']).filter((m) => m >= month && ctx.isLocked(m));
  if (lockedMonths.length) return alert(`${[...new Set(lockedMonths)].join('、')} 所屬季度已結算鎖定，生效月份請設在之後`);
  const confirmedAfter = ctx.db['月業績'].filter((r) => r['月份'] >= month && r['確認狀態'] === '已確認');
  if (!confirm(`新增 ${month} 起生效的參數：T1 ${fmt(p.T1)}、T2 ${fmt(p.T2)}、R1 ${p.R1 * 100}%、R2 ${p.R2 * 100}%？${
    confirmedAfter.length ? `\n\n注意：${month} 之後已有 ${confirmedAfter.length} 筆已確認的月業績，獎金會依新參數重算。` : ''}`)) return;
  const rows = Object.entries(p).map(([k, v]) => ({ 參數名稱: k, 數值: v, 生效月份: month }));
  try {
    await ctx.write([
      { action: 'replace', payload: { sheet: '參數', match: { 生效月份: month }, rows } },
    ], { 動作: '修改參數', 內容: `${month} 起：${JSON.stringify(p)}` });
    await monthView.recalcFrom(ctx, month);
    $('#p-msg').textContent = `已新增 ${month} 版本，並重算 ${month} 之後的月業績獎金。`;
    renderParams();
  } catch (e) { alert('新增失敗：' + e.message); }
});

$('#map-reset').addEventListener('click', async () => {
  if (!confirm('還原為預設欄位對應？')) return;
  await ctx.write([{ action: 'upsert', payload: { sheet: '設定', keys: ['項目'], rows: [{ 項目: '訂單欄位對應', 值: JSON.stringify(DEFAULT_ORDER_MAPPING) }] } }],
    { 動作: '修改設定', 內容: '神美訂單欄位對應還原為預設' });
  settingsView.show(ctx);
});

$('#log-load').addEventListener('click', async () => {
  const rows = (await ctx.backend.call('read', { sheets: ['操作紀錄'] }))['操作紀錄'].slice(-100).reverse();
  $('#log-table').innerHTML = `<thead><tr><th>時間</th><th>動作</th><th>內容</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r['時間'])}</td><td style="text-align:left">${esc(r['動作'])}</td><td style="text-align:left;white-space:normal">${esc(r['內容'])}</td></tr>`).join('')}</tbody>`;
});

start();
