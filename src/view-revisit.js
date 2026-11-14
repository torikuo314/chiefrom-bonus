// 待回訪名單：每位養護師超過建議回店天數、還沒回來的客人（只列訂單號碼，不存個資）
import { $, $$, esc, fmt } from './ui.js';
import { indexOf } from './analytics.js';
import { revisitList, revisitText } from './revisit.js';
import { download } from './export.js';

let ctx;
let who = '';

export function init(c) {
  ctx = c;
  $('#rv-staff').addEventListener('change', (e) => { who = e.target.value; render(); });
  $('#rv-days').addEventListener('change', render);
}

export function show() {
  if (!who && ctx.settings.staff.length) who = ctx.settings.staff[0].name; // 預設第一位，避免一次列太長
  $('#rv-staff').innerHTML = `<option value="">全部養護師</option>${ctx.settings.staff.map((p) => `<option ${p.name === who ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  $('#rv-days').value ||= ctx.settings.metric.revisitDays;
  render();
}

function render() {
  const index = indexOf(ctx);
  if (!index.dataEnd) {
    $('#rv-body').innerHTML = '<p class="hint">尚未匯入神美訂單列表。</p>';
    return;
  }
  const days = Number($('#rv-days').value) || ctx.settings.metric.revisitDays;
  const ref = index.dataEnd;
  const staff = who ? ctx.settings.staff.filter((p) => p.name === who) : ctx.settings.staff;
  $('#rv-ref').textContent = `以訂單資料最後一天 ${ref} 為基準；超過 ${days} 天、${ctx.settings.metric.revisitMaxDays} 天以內沒有回來的客人。負責人＝客人最後一次來時擔任設計師的人。`;
  $('#rv-body').innerHTML = staff.map((p) => {
    const list = revisitList(index, p.name, ref, { days, maxDays: ctx.settings.metric.revisitMaxDays });
    return `<section class="rv-staff">
      <div class="row-between"><h3>${esc(p.name)} <span class="hint">${list.length} 位</span></h3>
        ${list.length ? `<span><button class="mini" data-copy="${esc(p.name)}">複製文字（貼到 LINE）</button> <button class="mini" data-csv="${esc(p.name)}">下載 CSV</button></span>` : ''}</div>
      ${list.length ? `<table><thead><tr><th>訂單號碼</th><th>上次來</th><th>幾天前</th><th>累計來店</th><th class="l">上次項目</th></tr></thead><tbody>${
        list.map((x) => `<tr><td>${esc(x.orderNo)}</td><td>${esc(x.date)}</td><td>${fmt(x.daysSince)}</td><td>${fmt(x.visits)} 次</td><td class="l wrap">${esc(x.items.join('、'))}</td></tr>`).join('')}</tbody></table>`
        : '<p class="hint">目前沒有待回訪的客人</p>'}
    </section>`;
  }).join('');
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const list = revisitList(index, b.dataset.copy, ref, { days, maxDays: ctx.settings.metric.revisitMaxDays });
    const text = revisitText(b.dataset.copy, list, ref, days);
    try { await navigator.clipboard.writeText(text); b.textContent = '已複製 ✓'; } catch { prompt('請複製以下文字：', text); }
  }));
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => {
    const list = revisitList(index, b.dataset.csv, ref, { days, maxDays: ctx.settings.metric.revisitMaxDays });
    const csv = ['訂單號碼,上次來,幾天前,累計來店,上次項目', ...list.map((x) => [x.orderNo, x.date, x.daysSince, x.visits, `"${x.items.join('、').replace(/"/g, '""')}"`].join(','))].join('\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${ref}_${b.dataset.csv}_待回訪名單.csv`);
  }));
}
