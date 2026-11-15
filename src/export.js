// 明細匯出共用：截圖成 PNG／JPEG、產生 PDF（可多頁）、打包 zip、下載。
// 結果格式：{ name, png, jpg, pages?: [{ png, jpg }, ...] }；有 pages 時 PDF 為多頁、PNG 依頁分檔。
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function capture(el) {
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: css('--surface'), logging: false });
  return { png: canvas.toDataURL('image/png'), jpg: canvas.toDataURL('image/jpeg', 0.9) };
}

const pagesOf = (r) => (typeof r === 'string' ? [{ jpg: r }] : r.pages || [r]);

/** r：結果物件或單張 jpg dataURL。 */
export function pdfBlob(r) {
  const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pagesOf(r).forEach((p, i) => {
    if (i) doc.addPage();
    doc.addImage(p.jpg, 'JPEG', 0, 0, 210, 297);
  });
  return doc.output('blob');
}

export function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: head.match(/:(.*?);/)[1] });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** 多頁時 PNG 檔名加「_第N頁」。 */
const pngFiles = (r, fileName) => {
  const ps = pagesOf(r);
  return ps.map((p, i) => [ps.length > 1 ? fileName(r.name, 'png').replace(/\.png$/, `_第${i + 1}頁.png`) : fileName(r.name, 'png'), p.png]);
};

export async function downloadZip(results, fileName, zipName) {
  const zip = new JSZip();
  for (const r of results) {
    for (const [n, png] of pngFiles(r, fileName)) zip.file(n, dataUrlToBlob(png));
    zip.file(fileName(r.name, 'pdf'), pdfBlob(r));
  }
  download(await zip.generateAsync({ type: 'blob' }), zipName);
}

/** 在預覽區顯示結果並綁定下載按鈕。 */
export function renderPreviews(container, results, fileName, label) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  container.innerHTML = results.map((r, i) => `
    <figure class="sheet-preview">
      <div class="sheet-pages">${pagesOf(r).map((p) => `<img src="${p.png}" alt="${esc(r.name)} ${esc(label)}">`).join('')}</div>
      <figcaption>${esc(r.name)}${pagesOf(r).length > 1 ? ` <span class="hint">${pagesOf(r).length} 頁</span>` : ''}
        <button class="mini" data-png="${i}">PNG</button>
        <button class="mini" data-pdf="${i}">PDF</button></figcaption>
    </figure>`).join('');
  container.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', () => {
    for (const [n, png] of pngFiles(results[b.dataset.png], fileName)) download(dataUrlToBlob(png), n);
  }));
  container.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => {
    const r = results[b.dataset.pdf];
    download(pdfBlob(r), fileName(r.name, 'pdf'));
  }));
}
