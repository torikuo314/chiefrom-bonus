// 產出「個人經營月報」（v2 §8）：A4 直式，下載 PNG／PDF，多人打包 zip。
// 內容只來自 buildStatement()：含本月預估獎金、本季已預支；不含比例、級距業績、店內平均數字、排名。
import { $, $$, esc, fmt } from './ui.js';
import { buildStatement, topRanks, RANKED_KEYS } from './statement.js';
import { metricsOf, praiseOf, prevMonthOf, ranksOf, historyOf } from './analytics.js';
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
        history: historyOf(ctx, name, month, 12),
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
const wan = (v) => (v >= 10000 ? `${+(v / 10000).toFixed(1)}萬` : fmt(v));

function sheetHtml(d) {
  const [y, m] = d.month.split('-');
  return `
  <header class="st-head">
    <div class="st-brand">頭沐 | CHIEFROM</div>
    <div class="st-doc">個人經營月報</div>
  </header>
  <section class="mr-top">
    <div class="mr-who"><h1>${esc(d.name)}</h1><p>${y} 年 ${Number(m)} 月</p></div>
    <div class="mr-sales"><span>本月業績${d.salesBest ? '<em class="mr-best">🎉 個人新高</em>' : ''}</span><b><small>NT$</small> ${fmt(d.sales)}</b></div>
  </section>
  <section class="st-progress mr-progress">
    <div class="st-track">
      <div class="st-fill" style="width:${d.progress.percent}%"></div>
      ${d.progress.marks.map((k) => `<i class="st-mark" style="left:${k.percent}%"></i>`).join('')}
      <i class="mr-dot" style="left:${d.progress.percent}%"></i>
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
    ${d.cards.map((c) => `<div class="mr-card${c.best ? ' is-best' : ''}">
      <span>${c.label}</span>
      <b class="${c.pending ? 'pending' : ''}">${esc(c.value)}${c.unit ? `<small> ${c.unit}</small>` : ''}${c.small ? '<sup>*</sup>' : ''}</b>
      <em class="${c.diff ? c.diff.dir : ''}">${c.diff ? esc(c.diff.text) : '&nbsp;'}</em>
      <div class="mr-tags">${c.best ? '<span class="mr-best">🎉 個人新高</span>' : ''}${c.rank ? `<span class="mr-rank">店內第 ${c.rank} 名</span>` : ''}</div>
      ${c.note ? `<i>${esc(c.note)}</i>` : ''}
    </div>`).join('')}
  </section>
  <p class="mr-foot-note">↑↓ 為與上月比較${d.smallSampleNote ? '・* 樣本數少，僅供參考' : ''}</p>

  <section class="st-chart mr-trend">
    <h2>近 6 個月業績</h2>
    <canvas class="c-trend" width="666" height="${d.praise ? 150 : 190}"></canvas>
  </section>

  ${d.praise ? `<section class="mr-praise">
    <h2>客人怎麼說 <span>本月被客人點名 ${d.praise.mentions} 次</span></h2>
    <div class="mr-quotes">${d.praise.quotes.map((q) => `<blockquote><i>“</i>${esc(q.length > 60 ? q.slice(0, 58) + '…' : q)}</blockquote>`).join('')}</div>
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
  const font = { family: css('--font-sans') || 'sans-serif', size: 13 };
  try {
    const last = d.trend.length - 1;
    const canvas = sheet.querySelector('.c-trend');
    canvas.style.height = `${canvas.height}px`;
    const maxV = Math.max(...d.trend.map((t) => t.sales || 0), d.progress.T2) * 1.12;
    charts.push(new Chart(canvas, {
      type: 'bar',
      data: {
        labels: d.trend.map((t) => `${Number(t.month.slice(5))} 月`),
        datasets: [{
          data: d.trend.map((t) => t.sales),
          backgroundColor: d.trend.map((_, i) => (i === last ? css('--accent') : '#e4ddd1')),
          borderRadius: { topLeft: 5, topRight: 5 }, borderSkipped: 'bottom', barPercentage: 0.5, categoryPercentage: 0.9,
        }],
      },
      options: {
        responsive: false, animation: false, devicePixelRatio: 2, layout: { padding: { top: 26, right: 70 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false }, border: { color: css('--line') }, ticks: { color: css('--ink'), font: { ...font, weight: '500' } } },
          y: { display: false, beginAtZero: true, max: maxV },
        },
      },
      plugins: [{
        id: 'labelsAndGoals',
        beforeDatasetsDraw(chart) {
          // 門檻虛線畫在長條後面（不標金額）
          const c = chart.ctx;
          const { left, right } = chart.chartArea;
          for (const [label, v] of [['第一門檻', d.progress.T1], ['第二門檻', d.progress.T2]]) {
            const yy = chart.scales.y.getPixelForValue(v);
            c.save();
            c.strokeStyle = ink; c.setLineDash([4, 4]); c.lineWidth = 1;
            c.beginPath(); c.moveTo(left, yy); c.lineTo(right, yy); c.stroke();
            c.setLineDash([]); c.fillStyle = ink; c.font = `500 11px ${font.family}`; c.textAlign = 'left'; c.textBaseline = 'middle';
            c.fillText(label, right + 8, yy);
            c.restore();
          }
        },
        afterDatasetsDraw(chart) {
          const c = chart.ctx;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const v = d.trend[i].sales;
            if (v == null) return;
            const text = wan(v);
            c.save();
            c.font = `${i === last ? 700 : 500} ${i === last ? 13 : 11}px ${font.family}`;
            c.textAlign = 'center'; c.textBaseline = 'bottom';
            const w = c.measureText(text).width + 8;
            c.fillStyle = css('--surface');
            c.fillRect(bar.x - w / 2, bar.y - 24, w, 18);
            c.fillStyle = i === last ? css('--ink') : ink;
            c.fillText(text, bar.x, bar.y - 7);
            c.restore();
          });
        },
      }],
    }));
    return await capture(sheet);
  } finally {
    charts.forEach((c) => c.destroy());
    sheet.remove();
  }
}
