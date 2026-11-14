// 共用的畫面工具
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const fmt = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('en-US'));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const split = (s) => String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
export const num = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')) || 0);
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
export const thisMonth = () => today().slice(0, 7);
export function prevMonth(m) {
  let [y, mo] = m.split('-').map(Number);
  if (--mo < 1) { mo = 12; y--; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
