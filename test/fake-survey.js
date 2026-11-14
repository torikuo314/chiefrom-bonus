// 問卷假資料產生器（v2 §15：依 §5.1 欄位產生 30 筆假資料）。
// 全部是虛構的養護師與留言，不含任何真實資料。
export const SURVEY_HEADERS = [
  '請問您知道這次養護師的名字嗎？她最讓你印象深刻的部分是什麼呢？',
  '如果要給頭沐三個形容詞，會是什麼呢？',
  '如果能再更好，您會想告訴我們什麼呢？',
  '您有多大可能將頭沐推薦給家人朋友？(最大可能為5顆星)',
  '消費時間', '送出調查時間', '回覆時間',
];

export const FAKE_STAFF = [
  { name: '甲甲', aliases: [], nicknames: ['阿甲', '33', 'Jia', '甲甲'] },
  { name: '乙乙', aliases: ['Yvonne'], nicknames: ['小乙', 'Yi', '乙子'] },
  { name: '丙丙', aliases: [], nicknames: ['丙姐', 'Bing', '丙丙'] },
];

const MENTIONS = [
  '甲甲，按摩力道剛剛好，很放鬆', '阿甲很細心，會解釋頭皮狀況', 'jia 超溫柔！', '小乙的染髮顏色好自然',
  'Yvonne 很專業，推薦的洗髮精很好用', '丙丙和甲甲都很親切', '丙姐講解得很清楚', '不知道名字，但服務很好',
  '不記得了，整體很舒服', '33 號的養護師很棒', '我今年 33 歲第一次來', '短髮的那位，很會聊天',
  'Bing 很有耐心', '甲甲超讚', '忘了問名字', '乙子人很好', '', 'Jiaying 很可愛', '小乙手法很好', '丙丙',
  '甲甲，頭皮變得很清爽', 'Yi 很溫柔', '沒注意名字', '阿甲推薦的養髮液很有感', '丙姐', '戴眼鏡的養護師',
  '甲甲 和 小乙 都很好', '很舒服，下次再來', 'Yvonne!!', '甲甲',
];
const ADJ = ['溫暖、專業、放鬆', '自然、舒服、安靜', '療癒、細心、乾淨', '舒適、專業、香'];
const SUGGEST = ['廁所可以再多一間', '', '冷氣有點冷', '希望有停車位', '', '預約可以更方便', '', '椅子可以再軟一點', '', '沒有，很好'];
const STARS = [5, 5, 4, 5, 0, 3, 5, 2, 5, 4];

/** 產生 30 筆假問卷（二維陣列，含表頭）。 */
export function fakeSurveyRows(month = '2099-03') {
  const rows = [SURVEY_HEADERS];
  for (let i = 0; i < 30; i++) {
    const d = `${month}-${String((i % 28) + 1).padStart(2, '0')}`;
    rows.push([MENTIONS[i], ADJ[i % ADJ.length], SUGGEST[i % SUGGEST.length], STARS[i % STARS.length], d, `${d} 20:${String(i).padStart(2, '0')}`, `${d} 21:00`]);
  }
  return rows;
}
