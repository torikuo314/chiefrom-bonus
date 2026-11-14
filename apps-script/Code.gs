/**
 * 頭沐 | CHIEFROM 業績系統 — Google Apps Script 後端
 * 綁定在試算表上（擴充功能 → Apps Script），部署為「網頁應用程式」。
 * token 存在「專案設定 → 指令碼屬性」的 TOKEN，不寫在程式碼裡。
 * 只接受 POST（token 放在 body，不會出現在網址紀錄）。
 */

var SCHEMA = {
  '養護師': ['姓名', '別名', '所屬門店', '在職狀態'],
  '交易明細': ['月份', '門店', '報表名稱', '養護師', '身分', '處理', '服務業績', '商品業績', '金額', '客次', '客數', '匯入批次'],
  '月業績': ['月份', '養護師', '業績', '服務業績', '商品業績', '筆數', '客數', '客單價', '第一級業績', '第二級業績', '當月獎金',
          '調整金額', '調整原因', '確認狀態', '確認日期', '確認方式', '備註'],
  '預支': ['編號', '日期', '養護師', '金額', '備註', '已簽同意書', '扣抵季度'],
  '季結算': ['季度', '養護師', '季獎金合計', '上季結轉', '本季預支', '實發金額', '結轉下季', '結算日期', '發放日期', '鎖定狀態'],
  '參數': ['參數名稱', '數值', '生效月份'],
  '設定': ['項目', '值'],
  '操作紀錄': ['時間', '動作', '內容']
};
// 這些欄位設為純文字，避免 Google 試算表把「2026-10」自動轉成日期
var TEXT_COLS = ['月份', '季度', '生效月份', '日期', '編號', '時間', '確認日期', '結算日期', '發放日期', '扣抵季度', '匯入批次'];
var DEFAULT_PARAMS = [['T1', 140000], ['T2', 220000], ['R1', 0.2], ['R2', 0.3]];

function doGet() {
  return json_({ ok: false, error: '請使用 POST' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '格式錯誤' }); }
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || token.length < 16) return json_({ ok: false, error: '伺服器尚未設定 TOKEN（至少 16 字元）' });
  if (req.token !== token) return json_({ ok: false, error: 'token 錯誤' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return json_({ ok: true, data: handle_(req.action, req.payload || {}) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function handle_(action, p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  switch (action) {
    case 'ping':
      return { name: ss.getName() };
    case 'init':
      return init_(ss);
    case 'read': // { sheets: ['月業績', ...] } → { 月業績: [ {欄:值}, ... ] }
      var out = {};
      (p.sheets || Object.keys(SCHEMA)).forEach(function (n) { out[n] = readRows_(sheet_(ss, n)); });
      return out;
    case 'replace': // 刪除符合 match 的列後寫入 rows：{ sheet, match: {欄: 值}, rows: [...] }
      var sh = sheet_(ss, p.sheet);
      var removed = deleteWhere_(sh, p.match || {});
      appendRows_(sh, p.rows || []);
      return { removed: removed, added: (p.rows || []).length };
    case 'upsert': // 依 keys 更新或新增：{ sheet, keys: ['月份','養護師'], rows }
      return upsert_(sheet_(ss, p.sheet), p.keys, p.rows || []);
    case 'append':
      appendRows_(sheet_(ss, p.sheet), p.rows || []);
      return { added: (p.rows || []).length };
    case 'batch': // { ops: [{action, payload}, ...], log: {動作, 內容} } 一次完成多個寫入
      var results = (p.ops || []).map(function (op) {
        if (op.action === 'batch' || op.action === 'init') throw new Error('batch 內不可巢狀');
        return handle_(op.action, op.payload);
      });
      if (p.log) appendRows_(sheet_(ss, '操作紀錄'), [{ '時間': now_(), '動作': p.log['動作'], '內容': p.log['內容'] }]);
      return results;
    default:
      throw new Error('未知的動作：' + action);
  }
}

function init_(ss) {
  var created = [];
  Object.keys(SCHEMA).forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) { sh = ss.insertSheet(n); created.push(n); }
    var head = SCHEMA[n];
    var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    head.forEach(function (h) { if (cur.indexOf(h) < 0) cur.push(h); });
    sh.getRange(1, 1, 1, cur.length).setValues([cur]).setFontWeight('bold');
    cur.forEach(function (h, i) {
      if (TEXT_COLS.indexOf(h) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    sh.setFrozenRows(1);
  });
  var params = ss.getSheetByName('參數');
  if (params.getLastRow() < 2) {
    appendRows_(params, DEFAULT_PARAMS.map(function (r) { return { '參數名稱': r[0], '數值': r[1], '生效月份': '2026-01' }; }));
  }
  appendRows_(ss.getSheetByName('操作紀錄'), [{ '時間': now_(), '動作': '初始化', '內容': '建立分頁：' + (created.join('、') || '無') }]);
  return { created: created };
}

// ---- 工具 ----
function sheet_(ss, name) {
  if (!SCHEMA[name]) throw new Error('不允許的分頁：' + name);
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('找不到分頁「' + name + '」，請先執行初始化');
  return sh;
}
function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}
function readRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var h = headers_(sh);
  return sh.getRange(2, 1, last - 1, h.length).getDisplayValues().map(function (r) {
    var o = {};
    h.forEach(function (k, i) { o[k] = r[i]; });
    return o;
  });
}
function appendRows_(sh, rows) {
  if (!rows.length) return;
  var h = headers_(sh);
  var values = rows.map(function (o) { return h.map(function (k) { return cell_(o[k]); }); });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, h.length).setValues(values);
}
function matches_(row, h, match) {
  return Object.keys(match).every(function (k) { return String(row[h.indexOf(k)]) === String(match[k]); });
}
function deleteWhere_(sh, match) {
  if (!Object.keys(match).length) throw new Error('replace 需要 match 條件');
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var h = headers_(sh);
  var data = sh.getRange(2, 1, last - 1, h.length).getDisplayValues();
  var n = 0;
  for (var i = data.length - 1; i >= 0; i--) {
    if (matches_(data[i], h, match)) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}
function upsert_(sh, keys, rows) {
  if (!keys || !keys.length) throw new Error('upsert 需要 keys');
  var h = headers_(sh);
  var last = sh.getLastRow();
  var data = last >= 2 ? sh.getRange(2, 1, last - 1, h.length).getDisplayValues() : [];
  var updated = 0, added = [];
  rows.forEach(function (o) {
    var match = {};
    keys.forEach(function (k) { match[k] = o[k]; });
    var idx = -1;
    for (var i = 0; i < data.length; i++) if (matches_(data[i], h, match)) { idx = i; break; }
    if (idx < 0) { added.push(o); return; }
    var row = h.map(function (k, j) { return o[k] === undefined ? data[idx][j] : cell_(o[k]); });
    sh.getRange(idx + 2, 1, 1, h.length).setValues([row]);
    data[idx] = row.map(String);
    updated++;
  });
  appendRows_(sh, added);
  return { updated: updated, added: added.length };
}
// 防止名稱被當成公式執行（例如以 = 開頭）
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v))) return "'" + v;
  return v;
}
function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 第一次部署時在編輯器中選擇此函式並按「執行」：
 * 產生一組隨機 token 存進指令碼屬性，並顯示在「執行記錄」中。
 * 已有 token 時不會覆蓋（要換 token 請先到專案設定刪除 TOKEN）。
 */
function setupToken() {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty('TOKEN');
  if (!t) {
    t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('TOKEN', t);
  }
  init_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('你的 token（請複製到業績系統的「設定」頁，勿外流）：' + t);
}
