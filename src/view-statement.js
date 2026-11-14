// 產出「個人經營月報」（v2 §8）：A4 直式，下載 PNG／PDF，多人打包 zip。
// 內容只來自 buildStatement()：含本月預估獎金、本季已預支；不含比例、級距業績、店內平均數字、排名。
import { $, $$, esc, fmt } from './ui.js';
import { buildStatement, topRanks, RANKED_KEYS } from './statement.js';
import { metricsOf, praiseOf, prevMonthOf, ranksOf } from './analytics.js';
import { css, capture, downloadZip, renderPreviews } from './export.js';

let ctx;
let month = null;
let results = []; // { name, png, jpg（dataURL） }

export function init(c) {
  ctx = c;
  $('#s-month').addEventListener('change', (e) => { month = e.target.value; renderPicker(); });
  $('#s-all').addEventListener('change', (e) => $$('#s-list input').forEach((i) => (i.checked = e.target.checked)));
  $('#s-make').addEventListener('click', make);
  $('#s-zip').addEventListener('click', () => downloadZip(results, fileName, `${month}_個人經營月報.zip`));
}

export function show(_c, arg = {}) {
  if (arg.month) month = arg.month;
  month ||= ctx.db['月業績'].map((r) => r['月份']).sort().at(-1) || '';
  renderPicker();
}

function renderPicker() {
  $('#s-month').value = month;
  const rows = ctx.db['月業績'].filter((r) => r['月份'] === month).sort((a, b) => a['養護師'].localeCompare(b['養護師'], 'zh-Hant'));
  $('#s-list').innerHTML = rows.length ? rows.map((r) => `
    <label class="check"><input type="checkbox" value="${esc(r['養護師'])}" checked> ${esc(r['養護師'])}
      <span class="badge s-${esc(r['確認狀態'] || '未確認')}">${esc(r['確認狀態'] || '未確認')}</span></label>`).join('')
    : `<p class="hint">${esc(month)} 尚未匯入資料。</p>`;
  $('#s-all').checked = true;
  $('#s-make').disabled = !rows.length;
  results = [];
  $('#s-results').innerHTML = '';
  $('#s-zip').hidden = true;
}

async function make() {
  const names = $$('#s-list input:checked').map((i) => i.value);
  if (!names.length) return alert('請至少勾選一位');
  const params = ctx.paramsFor(month);
  if (!params) return alert(`沒有 ${month} 適用的參數`);
  const btn = $('#s-make');
  btn.disabled = true;
  results = [];
  $('#s-results').innerHTML = '';
  try {
    await document.fonts.ready;
    const ranks = ranksOf(ctx, month, RANKED_KEYS, topRanks);
    for (const [i, name] of names.entries()) {
      btn.textContent = `產生中… ${i + 1}/${names.length}`;
      const data = buildStatement(ctx.db['月業績'], name, month, params, ctx.db['預支'], {
        cur: metricsOf(ctx, name, month), prev: metricsOf(ctx, name, prevMonthOf(month)),
        ranks: ranks[name] || {}, praise: praiseOf(ctx, name, [month]), returnDays: ctx.settings.metric.returnDays,
      });
      results.push({ name, ...(await renderSheet(data)) });
    }
    renderPreviews($('#s-results'), results, fileName, `${month} 個人經營月報`);
    $('#s-zip').hidden = results.length < 2;
  } catch (e) {
    alert('產生失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '產生月報';
  }
}

const fileName = (name, ext) => `${month}_${name}_個人經營月報.${ext}`;

// ---------------- 月報版面 ----------------
const wan = (v) => (v >= 10000 ? `${+(v / 10000).toFixed(1)} 萬` : fmt(v));

function sheetHtml(d) {
  const [y, m] = d.month.split('-');
  return `
  <header class="st-head">
    <div class="st-brand">頭沐 | CHIEFROM</div>
    <div class="st-doc">個人經營月報</div>
  </header>
  <section class="mr-top">
    <div class="mr-who"><h1>${esc(d.name)}</h1><p>${y} 年 ${Number(m)} 月</p></div>
    <div class="mr-sales"><span>本月業績</span><b><small>NT$</small> ${fmt(d.sales)}</b></div>
  </section>
  <section class="st-progress mr-progress">
    <div class="st-track">
      <div class="st-fill" style="width:${d.progress.percent}%"></div>
      ${d.progress.marks.map((k) => `<i class="st-mark" style="left:${k.percent}%"></i>`).join('')}
    </div>
    <div class="st-marklabels">${d.progress.marks.map((k) => `<span style="left:${k.percent}%">${k.label}</span>`).join('')}</div>
    <p class="st-progress-text">${esc(d.progress.text)}</p>
    <div class="mr-bonus-line">
      <div class="st-bonus"><span>本月預估獎金</span><b>NT$ ${fmt(d.estimatedBonus)}</b></div>
      ${d.quarterAdvance ? `<div class="st-bonus st-adv"><span>本季已預支</span><b>NT$ ${fmt(d.quarterAdvance)}</b></div>` : ''}
      <p class="st-bonus-note">預估獎金依當月業績試算${d.quarterAdvance ? `；本季已預支（截至 ${Number(m)} 月）將於季結算時扣抵` : ''}。實際發放金額以季結算為準。</p>
    </div>
  </section>

  <section class="mr-cards">
    ${d.cards.map((c) => `<div class="mr-card">
      <span>${c.label}</span>
      <b class="${c.pending ? 'pending' : ''}">${esc(c.value)}${c.unit ? `<small> ${c.unit}</small>` : ''}${c.small ? '<sup>*</sup>' : ''}</b>
      <em class="${c.diff ? c.diff.dir : ''}">${c.diff ? esc(c.diff.text) : '&nbsp;'}</em>
      ${c.rank ? `<span class="mr-rank">店內第 ${c.rank} 名</span>` : ''}
      ${c.note ? `<i>${esc(c.note)}</i>` : ''}
    </div>`).join('')}
  </section>
  ${d.smallSampleNote ? '<p class="mr-foot-note">* 樣本數少，僅供參考</p>' : ''}

  <section class="st-chart mr-trend">
    <h2>近 6 個月業績</h2>
    <canvas class="c-trend" width="666" height="220"></canvas>
  </section>

  ${d.praise ? `<section class="mr-praise">
    <h2>客人怎麼說 <span>本月被客人點名 ${d.praise.mentions} 次</span></h2>
    ${d.praise.quotes.map((q) => `<blockquote>「${esc(q.length > 56 ? q.slice(0, 54) + '…' : q)}」</blockquote>`).join('')}
  </section>` : ''}
  <footer class="st-foot">頭沐 | CHIEFROM</footer>`;
}

async function renderSheet(d) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet mrsheet';
  sheet.innerHTML = sheetHtml(d);
  $('#s-stage').appendChild(sheet);
  const charts = [];
  const ink = css('--ink-soft');
  const font = { family: css('--font-sans') || 'sans-serif', size: 12 };
  try {
    const last = d.trend.length - 1;
    charts.push(new Chart(sheet.querySelector('.c-trend'), {
      type: 'line',
      data: {
        labels: d.trend.map((t) => `${Number(t.month.slice(5))} 月`),
        datasets: [{
          data: d.trend.map((t) => t.sales), borderColor: css('--chart-1'), borderWidth: 2, tension: 0.25, spanGaps: false,
          pointRadius: d.trend.map((_, i) => (i === last ? 5 : 4)), pointBackgroundColor: css('--chart-1'), pointBorderColor: css('--surface'), pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: false, animation: false, devicePixelRatio: 2, layout: { padding: { top: 24, right: 24 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false }, border: { color: css('--line') }, ticks: { color: ink, font } },
          y: { beginAtZero: true, grid: { color: css('--chart-grid') }, border: { display: false }, ticks: { color: ink, font, maxTicksLimit: 4, callback: (v) => wan(v) } },
        },
      },
      plugins: [{
        id: 'lastLabel',
        afterDatasetsDraw(chart) {
          const pt = chart.getDatasetMeta(0).data[last];
          const v = d.trend[last].sales;
          if (!pt || v == null) return;
          const c = chart.ctx;
          c.save();
          c.fillStyle = css('--ink');
          c.font = `600 12px ${font.family}`;
          c.textAlign = 'center';
          c.fillText(fmt(v), pt.x, pt.y - 10);
          c.restore();
        },
      }],
    }));
    return await capture(sheet);
  } finally {
    charts.forEach((c) => c.destroy());
    sheet.remove();
  }
}
