// 明細匯出共用：截圖成 PNG／JPEG、產生 PDF、打包 zip、下載。
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function capture(el) {
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: css('--surface'), logging: false });
  return { png: canvas.toDataURL('image/png'), jpg: canvas.toDataURL('image/jpeg', 0.9) };
}

export function pdfBlob(jpg) {
  const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.addImage(jpg, 'JPEG', 0, 0, 210, 297);
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

/** results: [{ name, png, jpg }]；fileName(name, ext) */
export async function downloadZip(results, fileName, zipName) {
  const zip = new JSZip();
  for (const r of results) {
    zip.file(fileName(r.name, 'png'), dataUrlToBlob(r.png));
    zip.file(fileName(r.name, 'pdf'), pdfBlob(r.jpg));
  }
  download(await zip.generateAsync({ type: 'blob' }), zipName);
}

/** 在預覽區顯示結果並綁定下載按鈕。 */
export function renderPreviews(container, results, fileName, label) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  container.innerHTML = results.map((r, i) => `
    <figure class="sheet-preview">
      <img src="${r.png}" alt="${esc(r.name)} ${esc(label)}">
      <figcaption>${esc(r.name)}
        <button class="mini" data-png="${i}">PNG</button>
        <button class="mini" data-pdf="${i}">PDF</button></figcaption>
    </figure>`).join('');
  container.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', () => {
    const r = results[b.dataset.png];
    download(dataUrlToBlob(r.png), fileName(r.name, 'png'));
  }));
  container.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => {
    const r = results[b.dataset.pdf];
    download(pdfBlob(r.jpg), fileName(r.name, 'pdf'));
  }));
}
