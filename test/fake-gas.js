// 假的 Google Apps Script 環境（測試與本機 E2E 共用）
import fs from 'node:fs';
import vm from 'node:vm';

function fakeSheet(name) {
  const d = []; // 二維陣列
  const sh = {
    name, d, frozen: 0,
    getLastRow: () => d.length,
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
    insertSheet: (n) => (sheets[n] = fakeSheet(n)),
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '2099-01-01 00:00:00' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  const call = (action, payload, tk = token) =>
    ctx.doPost({ postData: { contents: JSON.stringify({ token: tk, action, payload }) } });
  return { call, sheets };
}

