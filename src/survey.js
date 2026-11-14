// 滿意度問卷匯入解析（v2 §5）。純函式。
import { toDate } from './orders.js';
import { monthOf } from './metrics.js';

// 欄位以「關鍵字包含」自動對應（問卷平台的題目文字可能略有不同）
export const SURVEY_FIELDS = [
  { key: 'mention', label: '第一題（養護師名字與印象）', match: ['養護師的名字', '印象深刻'], required: true },
  { key: 'adjectives', label: '三個形容詞', match: ['形容詞'] },
  { key: 'suggestion', label: '建議（如果能再更好）', match: ['再更好', '建議'] },
  { key: 'stars', label: '推薦星數', match: ['推薦', '星'], required: true },
  { key: 'date', label: '消費時間', match: ['消費時間', '消費日期'], required: true },
  { key: 'sentAt', label: '送出調查時間', match: ['送出調查時間', '送出時間'] },
  { key: 'replyAt', label: '回覆時間', match: ['回覆時間'] },
];

export function guessSurveyMapping(headers) {
  const m = {};
  for (const f of SURVEY_FIELDS) {
    const h = headers.find((x) => f.match.some((k) => String(x).includes(k)) && !Object.values(m).includes(x));
    if (h) m[f.key] = h;
  }
  return m;
}
export function checkSurveyMapping(headers, mapping) {
  const missing = SURVEY_FIELDS.filter((f) => (f.required && !mapping[f.key]) || (mapping[f.key] && !headers.includes(mapping[f.key]))).map((f) => f.label);
  return { ok: !missing.length, missing };
}

export const DEFAULT_ANONYMOUS = ['不知道', '不記得', '不太記得', '忘了', '忘記', '沒注意', '沒印象', '不清楚', '不確定名字'];
export const DEFAULT_ENV_KEYWORDS = ['廁所', '洗手間', '座位', '椅', '冷氣', '空調', '溫度', '櫃檯', '停車', '分店', '動線', '環境', '設備', '空間', '音樂', '燈光', '電梯', '門口'];

const hasCJK = (s) => /[㐀-鿿]/.test(s);
const isLatin = (s) => /^[a-z]+$/i.test(s);

/**
 * 暱稱是否「容易誤判」：純數字（77）、英文 2 字以下、中文單字、疊字（娜娜、琪琪）。
 * 養護師的正式姓名與別名不算（例如「小美」本身就是姓名）。
 */
export function isRiskyNickname(nick) {
  const n = String(nick).trim();
  if (/^\d+$/.test(n)) return true;
  if (isLatin(n) && n.length <= 2) return true;
  if (hasCJK(n) && n.length === 1) return true;
  if (hasCJK(n) && n.length === 2 && n[0] === n[1]) return true;
  return false;
}

/**
 * 比對第一題文字中的養護師。
 * staff: [{ name, aliases: [], nicknames: [] }]
 * 回傳 { sure: [姓名], unsure: [{ name, nick }], anonymous: bool }
 */
export function matchMentions(text, staff, { anonymous = DEFAULT_ANONYMOUS } = {}) {
  const t = String(text ?? '').trim();
  const lower = t.toLowerCase();
  const sure = new Set();
  const unsure = [];
  for (const p of staff) {
    const formal = [p.name, ...(p.aliases || [])].filter(Boolean);
    const nicks = (p.nicknames || []).filter((n) => n && !formal.includes(n));
    const hit = (n) => {
      const k = n.toLowerCase();
      if (!lower.includes(k)) return null;
      if (isLatin(n)) { // 英文需是獨立單字（避免 Hana 命中 Hanako）
        const re = new RegExp(`(^|[^a-z])${k}([^a-z]|$)`, 'i');
        return re.test(t) ? 'word' : 'part';
      }
      if (/^\d+$/.test(n)) { // 數字不能夾在其他數字中間
        const re = new RegExp(`(^|\\D)${k}(\\D|$)`);
        return re.test(t) ? 'word' : null; // 夾在其他數字中（如電話）不算
      }
      return 'word';
    };
    let found = false;
    for (const n of formal) {
      const h = hit(n);
      if (h === 'word') { sure.add(p.name); found = true; break; }
      if (h === 'part') unsure.push({ name: p.name, nick: n });
    }
    if (found) continue;
    for (const n of nicks) {
      const h = hit(n);
      if (!h) continue;
      if (h === 'word' && !isRiskyNickname(n)) { sure.add(p.name); found = true; break; }
      unsure.push({ name: p.name, nick: n });
    }
  }
  const uniqUnsure = unsure.filter((u, i) => !sure.has(u.name) && unsure.findIndex((x) => x.name === u.name) === i);
  const isAnon = !sure.size && !uniqUnsure.length && (!t || anonymous.some((a) => t.includes(a)));
  return { sure: [...sure], unsure: uniqUnsure, anonymous: isAnon };
}

/** 星數：0 或空白＝未評分（null）。 */
export function parseStars(v) {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

export function envFlag(suggestion, keywords = DEFAULT_ENV_KEYWORDS) {
  const s = String(suggestion ?? '');
  return keywords.filter((k) => s.includes(k));
}

/**
 * 解析問卷。
 * 回傳每筆：{ id, date, month, mention, adjectives, suggestion, stars, sure, unsure, anonymous,
 *   status: 'matched'|'pending'|'anonymous', negative(自動), envKeywords }
 *  pending：有不確定的暱稱，或有寫內容但比對不到任何人 → 交給管理者指定或標為未指名
 */
export function parseSurvey(rows, { mapping, staff, anonymous, envKeywords }) {
  const headers = (rows[0] || []).map((h) => String(h ?? '').trim());
  const col = (k) => (mapping[k] ? headers.indexOf(mapping[k]) : -1);
  const idx = Object.fromEntries(SURVEY_FIELDS.map((f) => [f.key, col(f.key)]));
  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] : null);
  const out = [];
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    if (!r || r.every((c) => c === null || c === undefined || c === '')) return;
    const date = toDate(get(r, 'date'));
    const mention = String(get(r, 'mention') ?? '').trim();
    const sentAt = String(get(r, 'sentAt') ?? '').trim();
    const id = `${date}|${sentAt}|${mention.slice(0, 40)}`;
    if (seen.has(id)) return; // 同一檔案內完全重複
    seen.add(id);
    const m = matchMentions(mention, staff, { anonymous });
    const stars = parseStars(get(r, 'stars'));
    const suggestion = String(get(r, 'suggestion') ?? '').trim();
    out.push({
      rowNo: i + 2, id, date, month: date ? monthOf(date) : null,
      mention, adjectives: String(get(r, 'adjectives') ?? '').trim(), suggestion, stars,
      sure: m.sure, unsure: m.unsure, anonymous: m.anonymous,
      status: m.unsure.length || (!m.sure.length && !m.anonymous) ? 'pending' : m.anonymous ? 'anonymous' : 'matched',
      negative: stars != null && stars <= 3,
      envKeywords: envFlag(suggestion, envKeywords),
    });
  });
  return { headers, items: out, months: [...new Set(out.map((x) => x.month).filter(Boolean))].sort() };
}

/**
 * 套用待處理決定：decisions[id] = { staff: [姓名...] } 或 { anonymous: true }
 * 回傳最終對應：每筆的 staff 陣列（未指名為空陣列）。
 */
export function resolveSurvey(items, decisions = {}) {
  return items.map((x) => {
    const d = decisions[x.id];
    if (x.status !== 'pending') return { ...x, staff: x.sure, resolved: true };
    if (d?.anonymous) return { ...x, staff: [], status: 'anonymous', resolved: true };
    if (d?.staff) return { ...x, staff: [...new Set([...x.sure, ...d.staff])], status: 'matched', resolved: true };
    return { ...x, staff: x.sure, resolved: false };
  });
}

/** 某位養護師某月的問卷統計（內部版）：點名數、平均星數（排除未評分）。 */
export function surveyStats(resolved, name, months) {
  const mine = resolved.filter((x) => months.includes(x.month) && x.staff.includes(name));
  const rated = mine.filter((x) => x.stars != null);
  return {
    mentions: mine.length,
    avgStars: rated.length ? rated.reduce((a, x) => a + x.stars, 0) / rated.length : null,
    rated: rated.length,
  };
}
