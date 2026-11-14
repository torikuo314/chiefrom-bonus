// 假的 Google Apps Script 環境（測試與本機 E2E 共用）
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

function fakeSheet(name) {
  const d = []; // 二維陣列
  const sh = {
    name, d, frozen: 0,
    // 與 Google 試算表相同：最後一列「有內容」的列號
    getLastRow: () => { for (let i = d.length - 1; i >= 0; i--) if ((d[i] || []).some((v) => v !== '' && v != null)) return i + 1; return 0; },
    setName(n) { sh.name = n; sh._rename?.(n); },
    getLastColumn: () => (d[0] ? d[0].length : 0),
    getMaxRows: () => 1000,
    setFrozenRows(n) { sh.frozen = n; },
    deleteRow(r) { d.splice(r - 1, 1); },
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] || [])[c - 1 + j] ?? '')),
        getDisplayValues: () => rng.getValues().map((row) => row.map((v) => String(v))),
        setValues(vals) {
          vals.forEach((row, i) => { d[r - 1 + i] ??= []; row.forEach((v, j) => { d[r - 1 + i][c - 1 + j] = v; }); });
          return rng;
        },
        setFontWeight: () => rng,
        setNumberFormat: () => rng,
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (d[r - 1 + i]) d[r - 1 + i][c - 1 + j] = ''; return rng; },
      };
      return rng;
    },
  };
  return sh;
}

export function loadGas(token = 'test-token-1234567890') {
  const sheets = {};
  const ss = {
    getName: () => '假試算表',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => {
      const sh = fakeSheet(n);
      sh._rename = (nn) => { delete sheets[sh._cur]; sheets[nn] = sh; sh._cur = nn; };
      sh._cur = n;
      return (sheets[n] = sh);
    },
  };
  const props = { TOKEN: token };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate: () => '2099-01-01 00:00:00',
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => [...crypto.createHash(alg).update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  const call = (action, payload, tk = token) =>
    ctx.doPost({ postData: { contents: JSON.stringify({ token: tk, action, payload }) } });
  return { call, sheets, props };
}

