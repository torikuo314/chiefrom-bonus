// 產出每月業績明細：A4 直式，下載 PNG／PDF，多人打包 zip。
// 明細內容只來自 buildStatement()：含本月預估獎金，不含比例與級距業績。
import { $, $$, esc, fmt } from './ui.js';
import { buildStatement } from './statement.js';
import { css, capture, downloadZip, renderPreviews } from './export.js';

let ctx;
let month = null;
let results = []; // { name, png, jpg（dataURL） }

export function init(c) {
  ctx = c;
  $('#s-month').addEventListener('change', (e) => { month = e.target.value; renderPicker(); });
  $('#s-all').addEventListener('change', (e) => $$('#s-list input').forEach((i) => (i.checked = e.target.checked)));
  $('#s-make').addEventListener('click', make);
  $('#s-zip').addEventListener('click', () => downloadAll());
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
    for (const [i, name] of names.entries()) {
      btn.textContent = `產生中… ${i + 1}/${names.length}`;
      const data = buildStatement(ctx.db['月業績'], name, month, params, ctx.db['預支']);
      results.push({ name, ...(await renderSheet(data)) });
    }
    renderResults();
  } catch (e) {
    alert('產生失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '產生明細';
  }
}

function renderResults() {
  renderPreviews($('#s-results'), results, fileName, `${month} 業績明細`);
  $('#s-zip').hidden = results.length < 2;
}

const downloadAll = () => downloadZip(results, fileName, `${month}_每月業績明細.zip`);
const fileName = (name, ext) => `${month}_${name}_每月業績明細.${ext}`;

// ---------------- 明細版面 ----------------
const wan = (v) => (v >= 10000 ? `${+(v / 10000).toFixed(1)} 萬` : fmt(v));

function sheetHtml(d) {
  const [y, m] = d.month.split('-');
  const mixTotal = d.mix.service + d.mix.product;
  const pct = (v) => (mixTotal ? Math.round((v / mixTotal) * 100) : 0);
  const mom = d.metrics.momPercent;
  const momText = mom == null ? '—' : `${mom > 0 ? '↑' : mom < 0 ? '↓' : '→'} ${Math.abs(mom)}%`;
  return `
  <header class="st-head">
    <div class="st-brand">頭沐 | CHIEFROM</div>
    <div class="st-doc">每月業績明細</div>
  </header>
  <section class="st-title">
    <h1>${esc(d.name)}</h1>
    <p>${y} 年 ${Number(m)} 月</p>
  </section>
  <section class="st-hero">
    <span>當月個人業績</span>
    <b><small>NT$</small> ${fmt(d.sales)}</b>
    <div class="st-bonus-row">
      <div class="st-bonus"><span>本月預估獎金</span><b>NT$ ${fmt(d.estimatedBonus)}</b></div>
      ${d.quarterAdvance ? `<div class="st-bonus st-adv"><span>本季已預支</span><b>NT$ ${fmt(d.quarterAdvance)}</b></div>` : ''}
    </div>
    <p class="st-bonus-note">預估獎金依當月業績試算${d.quarterAdvance ? `；本季已預支金額（截至 ${Number(d.month.slice(5))} 月）將於季結算時扣抵` : ''}。實際發放金額以季結算為準。</p>
  </section>
  <section class="st-progress">
    <div class="st-track">
      <div class="st-fill" style="width:${d.progress.percent}%"></div>
      ${d.progress.marks.map((k) => `<i class="st-mark" style="left:${k.percent}%"></i>`).join('')}
    </div>
    <div class="st-marklabels">${d.progress.marks.map((k) => `<span style="left:${k.percent}%">${k.label}</span>`).join('')}</div>
    <p class="st-progress-text">${esc(d.progress.text)}</p>
  </section>
  <section class="st-metrics">
    <div><span>服務筆數</span><b>${fmt(d.metrics.visits)}<small> 筆</small></b></div>
    <div><span>客數</span><b>${fmt(d.metrics.customers)}<small> 人</small></b></div>
    <div><span>客單價</span><b>${fmt(d.metrics.avgTicket)}<small> 元</small></b></div>
    <div><span>較上月</span><b>${momText}</b></div>
  </section>
  <section class="st-charts">
    ${mixTotal ? `<div class="st-chart st-mix">
      <h2>業績組成</h2>
      <div class="st-mix-body">
        <canvas class="c-mix" width="160" height="160"></canvas>
        <ul class="st-legend">
          <li><i style="background:${css('--chart-1')}"></i>服務<b>${fmt(d.mix.service)}</b><em>${pct(d.mix.service)}%</em></li>
          <li><i style="background:${css('--chart-2')}"></i>商品<b>${fmt(d.mix.product)}</b><em>${pct(d.mix.product)}%</em></li>
        </ul>
      </div>
    </div>` : ''}
    <div class="st-chart st-trend">
      <h2>近 6 個月業績</h2>
      <canvas class="c-trend" width="650" height="180"></canvas>
    </div>
  </section>
  <footer class="st-foot">頭沐 | CHIEFROM</footer>`;
}

async function renderSheet(d) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = sheetHtml(d);
  $('#s-stage').appendChild(sheet);
  const charts = [];
  const ink = css('--ink-soft');
  const font = { family: css('--font-sans') || 'sans-serif', size: 13 };
  try {
    const mixCanvas = sheet.querySelector('.c-mix');
    if (mixCanvas) {
      charts.push(new Chart(mixCanvas, {
        type: 'doughnut',
        data: { labels: ['服務', '商品'], datasets: [{ data: [d.mix.service, d.mix.product], backgroundColor: [css('--chart-1'), css('--chart-2')], borderColor: css('--surface'), borderWidth: 2 }] },
        options: { responsive: false, animation: false, devicePixelRatio: 2, cutout: '64%', plugins: { legend: { display: false }, tooltip: { enabled: false } } },
      }));
    }
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
        responsive: false, animation: false, devicePixelRatio: 2, layout: { padding: { top: 28, right: 24 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false }, border: { color: css('--line') }, ticks: { color: ink, font } },
          y: { beginAtZero: true, grid: { color: css('--chart-grid') }, border: { display: false }, ticks: { color: ink, font, maxTicksLimit: 5, callback: (v) => wan(v) } },
        },
      },
      plugins: [{ // 只標當月數值
        id: 'lastLabel',
        afterDatasetsDraw(chart) {
          const pt = chart.getDatasetMeta(0).data[last];
          const v = d.trend[last].sales;
          if (!pt || v == null) return;
          const c = chart.ctx;
          c.save();
          c.fillStyle = css('--ink');
          c.font = `500 13px ${font.family}`;
          c.textAlign = 'center';
          c.fillText(fmt(v), pt.x, pt.y - 12);
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
