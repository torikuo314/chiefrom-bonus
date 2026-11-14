// 問卷：匯入（暱稱比對、待處理）＋每月整理（勾選讚美留言、標記負評與環境類）。v2 §5
import { SURVEY_FIELDS, guessSurveyMapping, checkSurveyMapping, parseSurvey, resolveSurvey } from './survey.js';
import { $, $$, esc, fmt } from './ui.js';

let ctx;
let file = null; // { fileName, rows }
let decisions = {}; // { 問卷編號: { staff: [] } | { anonymous: true } }
let reviewMonth = null;

export function init(c) {
  ctx = c;
  const drop = $('#sv-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
  $('#sv-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; readFile(f); });
  $('#sv-map-save').addEventListener('click', saveMapping);
  $('#sv-month').addEventListener('change', (e) => { reviewMonth = e.target.value; renderReview(); });
  $('#sv-save').addEventListener('click', saveReview);
}

export function show(_c, arg = {}) {
  if (arg.month) reviewMonth = arg.month;
  renderImport();
  renderReview();
}

async function readFile(f) {
  if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    file = { fileName: f.name, rows };
    decisions = {};
    renderImport();
  } catch (e) {
    alert(`讀取 ${f.name} 失敗：${e.message}`);
  }
}

const headersOf = () => (file.rows[0] || []).map((h) => String(h ?? '').trim());
const mapping = () => ctx.settings.surveyMapping && checkSurveyMapping(headersOf(), ctx.settings.surveyMapping).ok ? ctx.settings.surveyMapping : guessSurveyMapping(headersOf());

function renderImport() {
  $('#sv-step-map').hidden = true;
  $('#sv-preview').hidden = true;
  $('#sv-fileinfo').textContent = file ? `${file.fileName}・${file.rows.length - 1} 筆` : '';
  if (!file) return;
  const m = mapping();
  if (!checkSurveyMapping(headersOf(), m).ok) return showMapping(m);
  showPreview(m);
}

function showMapping(m) {
  const headers = headersOf().filter(Boolean);
  $('#sv-map-form').innerHTML = SURVEY_FIELDS.map((f) => `
    <label>${f.label}${f.required ? ' <span class="warn">*</span>' : ''}
      <select data-k="${f.key}"><option value="">（不使用）</option>
        ${headers.map((h) => `<option ${m[f.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('');
  $('#sv-step-map').hidden = false;
}
async function saveMapping() {
  const m = {};
  $$('#sv-map-form select').forEach((s) => { if (s.value) m[s.dataset.k] = s.value; });
  if (!checkSurveyMapping(headersOf(), m).ok) return alert('請對應必填欄位');
  await ctx.write([{ action: 'upsert', payload: { sheet: '設定', keys: ['項目'], rows: [{ 項目: '問卷欄位對應', 值: JSON.stringify(m) }] } }],
    { 動作: '修改設定', 內容: '修改問卷欄位對應' });
  renderImport();
}

function parsed(m) {
  return parseSurvey(file.rows, { mapping: m, staff: ctx.settings.staff, anonymous: ctx.settings.anonymous, envKeywords: ctx.settings.envKeywords });
}

function showPreview(m) {
  const { items, months } = parsed(m);
  const res = resolveSurvey(items, decisions);
  const existingMonths = new Set(ctx.db['問卷'].map((r) => r['月份']));
  const pending = items.filter((x) => x.status === 'pending');
  const unresolved = res.filter((x) => !x.resolved).length;
  const count = (fn) => res.filter(fn).length;

  $('#sv-summary').innerHTML = [
    ['問卷筆數', items.length], ['月份', months.join('、') || '—'],
    ['已對應', count((x) => x.staff.length)], ['未指名', count((x) => x.resolved && !x.staff.length)],
    ['待處理', `${unresolved} / ${pending.length}`], ['負評（1–3 星）', count((x) => x.negative)],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  const over = months.filter((x) => existingMonths.has(x));
  $('#sv-note').innerHTML = over.length ? `<span class="warn">${esc(over.join('、'))} 已匯入過，確認匯入時會詢問是否覆蓋（已勾選的讚美與標記會保留）。</span>` : '';

  $('#sv-pending').innerHTML = pending.length ? `
    <thead><tr><th>第一題內容</th><th>系統猜測</th><th>對應到</th></tr></thead>
    <tbody>${pending.map((x) => {
      const d = decisions[x.id] || {};
      const picked = new Set(d.staff || []);
      return `<tr data-id="${esc(x.id)}"><td class="l wrap">${esc(x.mention) || '<span class="hint">（空白）</span>'}${x.sure.length ? `<br><span class="hint">已確定：${esc(x.sure.join('、'))}</span>` : ''}</td>
        <td class="l">${x.unsure.map((u) => `${esc(u.name)}（${esc(u.nick)}）`).join('<br>') || '<span class="hint">比對不到</span>'}</td>
        <td class="l picks">${ctx.settings.staff.map((p) => `<label class="check inline-check ${x.unsure.some((u) => u.name === p.name) ? 'guess' : ''}"><input type="checkbox" class="sv-pick" value="${esc(p.name)}" ${picked.has(p.name) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
          <button class="mini sv-anon ${d.anonymous ? 'on' : ''}">${d.anonymous ? '✓ 未指名' : '未指名'}</button></td></tr>`;
    }).join('')}</tbody>` : '<tbody><tr><td>沒有待處理的問卷 🎉</td></tr></tbody>';
  $('#sv-pending-wrap').hidden = false;
  $('#sv-rest-anon').hidden = !pending.length;
  $$('#sv-pending tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelectorAll('.sv-pick').forEach((cb) => cb.addEventListener('change', () => {
      const staff = [...tr.querySelectorAll('.sv-pick:checked')].map((x) => x.value);
      if (staff.length) decisions[id] = { staff }; else delete decisions[id];
      showPreview(m);
    }));
    tr.querySelector('.sv-anon').addEventListener('click', () => {
      decisions[id] = decisions[id]?.anonymous ? undefined : { anonymous: true };
      if (!decisions[id]) delete decisions[id];
      showPreview(m);
    });
  });
  $('#sv-rest-anon').onclick = () => {
    for (const x of pending) if (!decisions[x.id]) decisions[x.id] = { anonymous: true };
    showPreview(m);
  };

  $('#sv-import').disabled = !!unresolved || !items.length;
  $('#sv-import-msg').textContent = unresolved ? `還有 ${unresolved} 筆待處理` : '';
  $('#sv-import').onclick = () => doImport(res, months, over);
  $('#sv-preview').hidden = false;
}

async function doImport(res, months, over) {
  if (over.length && !confirm(`${over.join('、')} 的問卷已匯入過。\n按「確定」覆蓋（已勾選的讚美與標記會保留），按「取消」放棄。`)) return;
  const batchId = new Date().toISOString();
  const old = new Map(ctx.db['問卷'].map((r) => [r['編號'], r]));
  const keep = ['讚美勾選', '讚美文字', '季讚美勾選', '負評', '環境類', '環境已處理'];
  const rows = res.map((x) => {
    const prev = old.get(x.id);
    const row = {
      編號: x.id, 消費日期: x.date, 月份: x.month, 第一題: x.mention, 形容詞: x.adjectives, 建議: x.suggestion,
      星數: x.stars ?? '', 對應養護師: x.staff.join(', '), 未指名: x.staff.length ? '' : '是',
      讚美勾選: '', 讚美文字: '', 季讚美勾選: '', 負評: x.negative ? '是' : '', 環境類: x.envKeywords.length ? '是' : '', 環境已處理: '', 匯入批次: batchId,
    };
    if (prev) for (const k of keep) row[k] = prev[k]; // 保留之前的整理
    return row;
  });
  try {
    await ctx.write([{ action: 'replace', payload: { sheet: '問卷', match: { 月份: months }, rows } }],
      { 動作: '匯入問卷', 內容: `${months.join('、')}（${rows.length} 筆）${over.length ? '；覆蓋' : ''}` });
    file = null; decisions = {};
    reviewMonth = months.at(-1);
    renderImport();
    renderReview();
    $('#sv-import-msg').textContent = '';
    $('#sv-done').textContent = `已匯入 ${months.join('、')} 的問卷 ${rows.length} 筆。接著可以在下方勾選要放進月報的讚美留言。`;
  } catch (e) {
    alert('匯入失敗：' + e.message);
  }
}

// ---------------- 每月整理 ----------------
const split = (s) => String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);

function renderReview() {
  const all = ctx.db['問卷'];
  const months = [...new Set(all.map((r) => r['月份']).filter(Boolean))].sort().reverse();
  if (!reviewMonth || !months.includes(reviewMonth)) reviewMonth = months[0] || '';
  $('#sv-month').innerHTML = months.map((m) => `<option ${m === reviewMonth ? 'selected' : ''}>${m}</option>`).join('');
  $('#sv-review').hidden = !months.length;
  if (!months.length) return;
  const rows = all.filter((r) => r['月份'] === reviewMonth);
  const html = ctx.settings.staff.map((p) => {
    const mine = rows.filter((r) => split(r['對應養護師']).includes(p.name));
    if (!mine.length) return `<h3>${esc(p.name)} <span class="hint">本月沒有被點名</span></h3>`;
    return `<h3>${esc(p.name)} <span class="hint">被點名 ${mine.length} 次・建議勾選 2–3 則</span></h3>
      <table class="sv-list"><tbody>${mine.map((r) => {
        const picked = split(r['讚美勾選']).includes(p.name);
        return `<tr data-id="${esc(r['編號'])}" data-staff="${esc(p.name)}">
          <td><input type="checkbox" class="sv-praise" ${picked ? 'checked' : ''} ${r['負評'] === '是' ? 'title="負評不建議放進月報"' : ''}></td>
          <td class="l wrap"><textarea class="sv-text" rows="2">${esc(r['讚美文字'] || r['第一題'])}</textarea>
            <span class="hint">${r['星數'] ? `${esc(r['星數'])} 星` : '未評分'}${r['形容詞'] ? `・${esc(r['形容詞'])}` : ''}</span></td>
          <td><label class="check"><input type="checkbox" class="sv-neg" ${r['負評'] === '是' ? 'checked' : ''}> 負評</label></td></tr>`;
      }).join('')}</tbody></table>`;
  }).join('');
  const env = rows.filter((r) => r['建議']);
  $('#sv-review-body').innerHTML = html + `
    <h3>建議（第三題）<span class="hint">勾選「環境類」的只出現在公司內部版，不歸屬個人</span></h3>
    <table class="sv-list"><tbody>${env.map((r) => `<tr data-id="${esc(r['編號'])}"><td class="l wrap">${esc(r['建議'])}</td>
      <td><label class="check"><input type="checkbox" class="sv-env" ${r['環境類'] === '是' ? 'checked' : ''}> 環境類</label></td></tr>`).join('') || '<tr><td>本月沒有建議</td></tr>'}</tbody></table>`;
  $('#sv-saved').textContent = '';
}

async function saveReview() {
  const byId = new Map();
  const get = (id) => byId.get(id) || byId.set(id, { 編號: id }).get(id);
  const praise = new Map(); // id -> Set(staff)
  $$('#sv-review-body tr[data-staff]').forEach((tr) => {
    const id = tr.dataset.id;
    if (!praise.has(id)) praise.set(id, new Set());
    if (tr.querySelector('.sv-praise').checked) praise.get(id).add(tr.dataset.staff);
    const text = tr.querySelector('.sv-text').value.trim();
    const orig = ctx.db['問卷'].find((r) => r['編號'] === id)?.['第一題'] || '';
    get(id)['讚美文字'] = text === orig ? '' : text;
    get(id)['負評'] = tr.querySelector('.sv-neg').checked ? '是' : '';
  });
  for (const [id, set] of praise) get(id)['讚美勾選'] = [...set].join(', ');
  $$('#sv-review-body .sv-env').forEach((cb) => { get(cb.closest('tr').dataset.id)['環境類'] = cb.checked ? '是' : ''; });
  const rows = [...byId.values()];
  const counts = ctx.settings.staff.map((p) => [p.name, [...praise.values()].filter((s) => s.has(p.name)).length]).filter(([, c]) => c > 3);
  if (counts.length && !confirm(`${counts.map(([n, c]) => `${n} 勾了 ${c} 則`).join('、')}，月報建議 2–3 則。仍要儲存嗎？`)) return;
  try {
    await ctx.write([{ action: 'upsert', payload: { sheet: '問卷', keys: ['編號'], rows } }],
      { 動作: '整理問卷', 內容: `${reviewMonth}：讚美勾選 ${[...praise.values()].reduce((a, s) => a + s.size, 0)} 則` });
    renderReview();
    $('#sv-saved').textContent = '已儲存';
  } catch (e) { alert('儲存失敗：' + e.message); }
}
