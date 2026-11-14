// 資料後端：Google Apps Script（正式）或本機 localStorage（未設定連線時的測試模式）。
// 兩者提供相同的 call(action, payload) 介面，對應 apps-script/Code.gs。

export const SCHEMA = {
  '養護師': ['姓名', '別名', '暱稱', '所屬門店', '在職狀態', '納入比較'],
  '交易明細': ['月份', '訂單號碼', '列序', '訂單時間', '店家', '客人雜湊', '分類', '類別', '品項', '工作人員', '職位', '業績', '項目協助', '匯入批次'],
  '問卷': ['編號', '消費日期', '月份', '第一題', '形容詞', '建議', '星數', '對應養護師', '未指名', '讚美勾選', '讚美文字', '季讚美勾選',
    '負評', '環境類', '環境已處理', '匯入批次'],
  '月業績': ['月份', '養護師', '業績', '服務業績', '商品業績', '筆數', '客數', '客單價', '第一級業績', '第二級業績', '當月獎金',
    '調整金額', '調整原因', '確認狀態', '確認日期', '確認方式', '備註'],
  '預支': ['編號', '日期', '養護師', '金額', '備註', '已簽同意書', '扣抵季度'],
  '季結算': ['季度', '養護師', '季獎金合計', '上季結轉', '本季預支', '實發金額', '結轉下季', '結算日期', '發放日期', '鎖定狀態', '主管回饋', '下季目標'],
  '參數': ['參數名稱', '數值', '生效月份'],
  '設定': ['項目', '值'],
  '操作紀錄': ['時間', '動作', '內容'],
};

const CONN_KEY = 'chiefrom.conn';

export function getConnection() {
  try { return JSON.parse(localStorage.getItem(CONN_KEY)) || null; } catch { return null; }
}
export function setConnection(conn) {
  try { conn ? localStorage.setItem(CONN_KEY, JSON.stringify(conn)) : localStorage.removeItem(CONN_KEY); } catch {}
}

export function createBackend(conn = getConnection()) {
  return conn?.url && conn?.token ? remoteBackend(conn) : localBackend();
}

function remoteBackend({ url, token }) {
  return {
    mode: 'sheets',
    async call(action, payload = {}) {
      // text/plain 避免 CORS 預檢；Apps Script 會 302 轉址，fetch 自動跟隨
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, action, payload }) });
      if (!res.ok) throw new Error(`連線失敗（HTTP ${res.status}）`);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || '未知錯誤');
      return out.data;
    },
  };
}

// ---- 本機測試模式：語意與 Code.gs 相同 ----
export function localBackend(storage = globalThis.localStorage, key = 'chiefrom.localdb') {
  const loadDb = () => { try { return JSON.parse(storage.getItem(key)) || {}; } catch { return {}; } };
  const saveDb = (db) => storage.setItem(key, JSON.stringify(db));
  const now = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });
  const tbl = (db, s) => {
    if (!SCHEMA[s]) throw new Error('不允許的分頁：' + s);
    if (!db[s]) throw new Error(`找不到分頁「${s}」，請先執行初始化`);
    return db[s];
  };
  const norm = (s, rows) => rows.map((r) => Object.fromEntries(SCHEMA[s].map((k) => [k, r[k] == null ? '' : String(r[k])])));
  const match = (row, m) => Object.keys(m).every((k) => (Array.isArray(m[k]) ? m[k].map(String).includes(String(row[k])) : String(row[k]) === String(m[k])));

  function handle(db, action, p) {
    switch (action) {
      case 'ping': return { name: '本機測試模式' };
      case 'init': {
        const created = Object.keys(SCHEMA).filter((s) => !db[s]);
        created.forEach((s) => (db[s] = []));
        if (!db['參數'].length) db['參數'].push(...norm('參數', [['T1', 140000], ['T2', 220000], ['R1', 0.2], ['R2', 0.3]].map(([a, b]) => ({ 參數名稱: a, 數值: b, 生效月份: '2026-01' }))));
        db['操作紀錄'].push(norm('操作紀錄', [{ 時間: now(), 動作: '初始化', 內容: '建立分頁：' + (created.join('、') || '無') }])[0]);
        return { created };
      }
      case 'read': return Object.fromEntries((p.sheets || Object.keys(SCHEMA)).map((s) => [s, tbl(db, s).map((r) => ({ ...r }))]));
      case 'replace': {
        if (!p.match || !Object.keys(p.match).length) throw new Error('replace 需要 match 條件');
        const t = tbl(db, p.sheet);
        const kept = t.filter((r) => !match(r, p.match));
        db[p.sheet] = kept.concat(norm(p.sheet, p.rows || []));
        return { removed: t.length - kept.length, added: (p.rows || []).length };
      }
      case 'upsert': {
        const t = tbl(db, p.sheet);
        let updated = 0, added = 0;
        for (const o of p.rows || []) {
          const m = Object.fromEntries(p.keys.map((k) => [k, o[k]]));
          const row = t.find((r) => match(r, m));
          if (row) { for (const k of SCHEMA[p.sheet]) if (o[k] !== undefined) row[k] = String(o[k] ?? ''); updated++; }
          else { t.push(norm(p.sheet, [o])[0]); added++; }
        }
        return { updated, added };
      }
      case 'append': tbl(db, p.sheet).push(...norm(p.sheet, p.rows || [])); return { added: (p.rows || []).length };
      case 'importOrders': // 手機已在 call() 中轉成雜湊
        return handle(db, 'replace', { sheet: '交易明細', match: { 月份: p.months || [] }, rows: p.rows || [] });
      case 'batch': {
        const r = (p.ops || []).map((op) => handle(db, op.action, op.payload));
        if (p.log) tbl(db, '操作紀錄').push(norm('操作紀錄', [{ 時間: now(), ...p.log }])[0]);
        return r;
      }
      default: throw new Error('未知的動作：' + action);
    }
  }
  return {
    mode: 'local',
    async call(action, payload = {}) {
      payload = await hashPhones(action, payload, storage);
      const db = loadDb();
      const work = structuredClone(db); // 失敗時不留下半套寫入
      const out = handle(work, action, payload);
      saveDb(work);
      return out;
    },
  };
}

// 本機測試模式：手機在瀏覽器端以 SHA-256＋本機鹽值轉雜湊（正式模式由 Apps Script 處理）
async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function hashRows(rows, salt) {
  return Promise.all(rows.map(async (r) => {
    const { 手機: phone, ...rest } = r;
    const digits = String(phone || '').replace(/\D/g, '');
    return { ...rest, 客人雜湊: digits ? await sha256hex(salt + digits) : '' };
  }));
}
async function hashPhones(action, payload, storage) {
  const needs = action === 'importOrders' || (action === 'batch' && (payload.ops || []).some((o) => o.action === 'importOrders'));
  if (!needs) return payload;
  let salt = storage.getItem('chiefrom.localsalt');
  if (!salt) { salt = crypto.randomUUID(); storage.setItem('chiefrom.localsalt', salt); }
  if (action === 'importOrders') return { ...payload, rows: await hashRows(payload.rows || [], salt) };
  return { ...payload, ops: await Promise.all(payload.ops.map(async (o) => (o.action === 'importOrders' ? { ...o, payload: { ...o.payload, rows: await hashRows(o.payload.rows || [], salt) } } : o))) };
}
