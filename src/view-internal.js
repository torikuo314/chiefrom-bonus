// 公司內部版（只有管理者看）：全員比較、趨勢、下滑警示、助理紀錄、負評、環境類建議、當季獎金成本。v2 §9
import { $, $$, esc, fmt, num } from './ui.js';
import { buildIndex, staffMonthMetrics, radarScores, declining, addMonths, valueOf } from './metrics.js';
import { orderLinesFromSheet } from './monthly.js';
import { surveyStats } from './survey.js';
import { quarterOf, monthsOfQuarter } from './calc.js';

let ctx;
let month = null;
let trendKey = 'sales';

export const CORE = [
  { key: 'sales', label: '個人業績', kind: 'money' },
  { key: 'avgTicket', label: '客單價', kind: 'money' },
  { key: 'customers', label: '服務客數', kind: 'count' },
  { key: 'oldReturn', label: '老客準時回店率', kind: 'pct' },
  { key: 'newReturn', label: '新客回店率', kind: 'pct' },
  { key: 'productRatio', label: '商品推薦佔比', kind: 'pct' },
  { key: 'addonRate', label: '加購服務率', kind: 'pct' },
];

export function fmtMetric(m, kind) {
  if (m && typeof m === 'object') {
    if (m.pending) return '<span class="hint">資料累積中</span>';
    if (m.value == null) return '<span class="hint">—</span>';
    return `${(m.value * 100).toFixed(0)}%${m.smallSample ? '<sup title="樣本數少，僅供參考">*</sup>' : ''}`;
  }
  if (m == null) return '<span class="hint">—</span>';
  return kind === 'pct' ? `${(m * 100).toFixed(0)}%` : fmt(m);
}

export function init(c) {
  ctx = c;
  $('#in-month').addEventListener('change', (e) => { month = e.target.value; render(); });
  $('#in-trend').addEventListener('change', (e) => { trendKey = e.target.value; renderTrend(); });
}

export function show() {
  month ||= ctx.db['月業績'].map((r) => r['月份']).sort().at(-1) || '';
  $('#in-trend').innerHTML = CORE.map((c) => `<option value="${c.key}" ${c.key === trendKey ? 'selected' : ''}>${c.label}</option>`).join('');
  render();
}

let cache = null;
function data() {
  const sig = `${ctx.db['交易明細'].length}|${ctx.db['問卷'].length}|${JSON.stringify(ctx.settings.metric)}`;
  if (cache?.sig === sig) return cache;
  const lines = orderLinesFromSheet(ctx.db['交易明細']);
  cache = { sig, index: buildIndex(lines, ctx.settings.metric), memo: new Map() };
  return cache;
}
function metricsOf(name, m) {
  const d = data();
  const k = `${name}|${m}`;
  if (!d.memo.has(k)) d.memo.set(k, staffMonthMetrics(d.index, name, m, ctx.settings.metric));
  return d.memo.get(k);
}
const surveyRows = () => ctx.db['問卷'].map((r) => ({
  month: r['月份'], staff: String(r['對應養護師'] || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
  stars: r['星數'] === '' ? null : num(r['星數']),
}));

function render() {
  $('#in-month').value = month;
  const staff = ctx.settings.staff;
  if (!month || !ctx.db['交易明細'].length) {
    $('#in-body').hidden = true;
    $('#in-empty').hidden = false;
    return;
  }
  $('#in-body').hidden = false;
  $('#in-empty').hidden = true;
  const list = staff.map((p) => metricsOf(p.name, month));
  const radar = radarScores(list, staff.filter((p) => p.compare).map((p) => p.name));
  const last3 = [0, 1, 2].map((i) => addMonths(month, -i));
  const sv = surveyRows();
  const monthly = new Map(ctx.db['月業績'].filter((r) => r['月份'] === month).map((r) => [r['養護師'], r]));

  // 1. 全員並列比較表
  $('#in-compare').innerHTML = `
    <thead><tr><th>養護師</th>${CORE.map((c) => `<th>${c.label}</th>`).join('')}<th>接手新客</th><th>問卷（近 3 月）</th><th>試算獎金</th></tr></thead>
    <tbody>${list.map((m, i) => {
      const p = staff[i];
      const st = surveyStats(sv, p.name, last3);
      const warn = CORE.filter((c) => declining(trendValues(p.name, c.key, 4), 3));
      return `<tr><td>${esc(p.name)}${p.compare ? '' : ' <span class="hint">不比較</span>'}${warn.length ? ` <span class="badge s-有異議" title="${esc(warn.map((w) => w.label).join('、'))}連續 3 個月下滑">⚠ ${warn.length}</span>` : ''}</td>
        ${CORE.map((c) => `<td>${fmtMetric(m[c.key], c.kind)}</td>`).join('')}
        <td>${fmt(m.newCustomers)}</td>
        <td>${st.mentions ? `${st.avgStars != null ? st.avgStars.toFixed(1) + ' 星' : '未評分'}<span class="hint">（${st.mentions} 份）</span>` : '<span class="hint">—</span>'}</td>
        <td>${monthly.has(p.name) ? fmt(monthly.get(p.name)['當月獎金']) : '<span class="hint">—</span>'}</td></tr>`;
    }).join('')}</tbody>`;
  const n0 = list.find((m) => m.newReturn?.window)?.newReturn.window;
  const o0 = list.find((m) => m.oldReturn?.baseMonth)?.oldReturn.baseMonth;
  $('#in-compare-note').textContent = `老客準時回店率以 ${o0 || '—'} 的消費為基準；新客回店率統計 ${n0 ? `${n0.from}～${n0.to}` : '—'} 接手的新客。＊樣本數少於 ${ctx.settings.metric.minSample}，僅供參考。⚠ 表示有指標連續 3 個月下滑（滑鼠移上去可看是哪幾項）。`;

  // 雷達分數（內部參考）
  $('#in-radar').innerHTML = `<thead><tr><th>養護師</th><th>產能</th><th>客單</th><th>留客</th><th>新客留存</th><th>推薦</th></tr></thead>
    <tbody>${staff.map((p) => `<tr><td>${esc(p.name)}</td>${['sales', 'avgTicket', 'oldReturn', 'newReturn', 'productRatio'].map((k) => `<td>${radar[p.name][k] ?? '<span class="hint">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>`;

  // 2. 下滑警示
  const warns = [];
  for (const p of staff) for (const c of CORE) if (declining(trendValues(p.name, c.key, 4), 3)) warns.push(`${p.name}：${c.label}`);
  $('#in-warn').innerHTML = warns.length ? warns.map((w) => `<li>${esc(w)}　連續 3 個月下滑</li>`).join('') : '<li class="hint">目前沒有連續 3 個月下滑的指標</li>';

  renderTrend();

  // 3. 助理紀錄
  $('#in-assist').innerHTML = `<thead><tr><th>養護師</th><th>找助理次數</th><th>項目協助金額</th><th>擔任助理次數</th><th>擔任助理業績</th></tr></thead>
    <tbody>${list.map((m, i) => `<tr><td>${esc(staff[i].name)}</td><td>${fmt(m.assistUsed.count)}</td><td>${fmt(m.assistUsed.amount)}</td><td>${fmt(m.asAssistant.count)}</td><td>${fmt(m.asAssistant.amount)}</td></tr>`).join('')}</tbody>`;

  // 4. 負評（本月）
  const neg = ctx.db['問卷'].filter((r) => r['月份'] === month && r['負評'] === '是');
  $('#in-neg').innerHTML = neg.length ? `<thead><tr><th>消費日期</th><th>養護師</th><th>星數</th><th>第一題</th><th>建議</th></tr></thead>
    <tbody>${neg.map((r) => `<tr><td>${esc(r['消費日期'])}</td><td>${esc(r['對應養護師'] || '未指名')}</td><td>${esc(r['星數'] || '未評分')}</td><td class="l wrap">${esc(r['第一題'])}</td><td class="l wrap">${esc(r['建議'])}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="hint">本月沒有負評</td></tr></tbody>';

  // 5. 環境類建議（全部，可標記已處理）
  const env = ctx.db['問卷'].filter((r) => r['環境類'] === '是').sort((a, b) => (a['消費日期'] < b['消費日期'] ? 1 : -1));
  $('#in-env').innerHTML = env.length ? `<thead><tr><th>消費日期</th><th>建議</th><th>已處理</th></tr></thead>
    <tbody>${env.map((r) => `<tr class="${r['環境已處理'] === '是' ? 'done' : ''}"><td>${esc(r['消費日期'])}</td><td class="l wrap">${esc(r['建議'])}</td>
      <td><input type="checkbox" data-env="${esc(r['編號'])}" ${r['環境已處理'] === '是' ? 'checked' : ''}></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="hint">沒有環境類建議</td></tr></tbody>';
  $$('[data-env]').forEach((cb) => cb.addEventListener('change', async () => {
    try {
      await ctx.write([{ action: 'upsert', payload: { sheet: '問卷', keys: ['編號'], rows: [{ 編號: cb.dataset.env, 環境已處理: cb.checked ? '是' : '' }] } }],
        { 動作: '環境類建議', 內容: `${cb.checked ? '標記已處理' : '取消已處理'}：${env.find((r) => r['編號'] === cb.dataset.env)?.['建議'] || ''}` });
      render();
    } catch (e) { alert('儲存失敗：' + e.message); cb.checked = !cb.checked; }
  }));

  // 6. 當季獎金成本預估
  const q = quarterOf(month);
  const qm = monthsOfQuarter(q);
  const rows = ctx.db['月業績'].filter((r) => qm.includes(r['月份']));
  const names = [...new Set(rows.map((r) => r['養護師']))];
  const total = rows.reduce((a, r) => a + num(r['當月獎金']), 0);
  const done = qm.filter((m) => rows.some((r) => r['月份'] === m));
  $('#in-cost').innerHTML = `<thead><tr><th>養護師</th>${qm.map((m) => `<th>${Number(m.slice(5))} 月</th>`).join('')}<th>本季累計</th></tr></thead>
    <tbody>${names.map((n) => {
      const per = qm.map((m) => rows.find((r) => r['月份'] === m && r['養護師'] === n));
      return `<tr><td>${esc(n)}</td>${per.map((r) => `<td>${r ? fmt(r['當月獎金']) : '<span class="hint">—</span>'}</td>`).join('')}<td><b>${fmt(per.reduce((a, r) => a + (r ? num(r['當月獎金']) : 0), 0))}</b></td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td>合計</td>${qm.map((m) => `<td>${fmt(rows.filter((r) => r['月份'] === m).reduce((a, r) => a + num(r['當月獎金']), 0))}</td>`).join('')}<td>${fmt(total)}</td></tr></tfoot>`;
  $('#in-cost-note').textContent = `${q}：已有 ${done.length} 個月資料${done.length < 3 ? `；以目前平均推估整季約 ${fmt(done.length ? (total / done.length) * 3 : 0)} 元` : ''}。實際發放金額另扣預支。`;
}

/** 某人某指標的近 n 個月數值（舊→新）。 */
function trendValues(name, key, n) {
  return Array.from({ length: n }, (_, i) => addMonths(month, i - n + 1)).map((m) => valueOf(metricsOf(name, m)[key]));
}

function renderTrend() {
  const c = CORE.find((x) => x.key === trendKey);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
  const first = ctx.db['交易明細'].map((r) => r['月份']).sort()[0];
  const shown = months.filter((m) => !first || m >= first);
  $('#in-trend-table').innerHTML = `<thead><tr><th>養護師</th>${shown.map((m) => `<th>${m.slice(2).replace('-', '/')}</th>`).join('')}</tr></thead>
    <tbody>${ctx.settings.staff.map((p) => {
      let prev = null;
      return `<tr><td>${esc(p.name)}</td>${shown.map((m) => {
        const v = metricsOf(p.name, m)[c.key];
        const cur = valueOf(v);
        const arrow = cur != null && prev != null ? (cur > prev ? '<span class="up">▲</span>' : cur < prev ? '<span class="down">▼</span>' : '') : '';
        prev = cur;
        return `<td>${fmtMetric(v, c.kind)}${arrow}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody>`;
}
