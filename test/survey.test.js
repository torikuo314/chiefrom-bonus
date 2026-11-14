// 問卷解析測試（假資料）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchMentions, isRiskyNickname, parseStars, envFlag, parseSurvey, resolveSurvey, surveyStats, guessSurveyMapping, checkSurveyMapping } from '../src/survey.js';
import { fakeSurveyRows, FAKE_STAFF, SURVEY_HEADERS } from './fake-survey.js';

const S = FAKE_STAFF;

test('容易誤判的暱稱', () => {
  assert.equal(isRiskyNickname('33'), true);
  assert.equal(isRiskyNickname('Yi'), true);
  assert.equal(isRiskyNickname('娜娜'), true);
  assert.equal(isRiskyNickname('阿甲'), false);
  assert.equal(isRiskyNickname('Bing'), false);
});

test('暱稱比對', () => {
  assert.deepEqual(matchMentions('甲甲，按摩很好', S).sure, ['甲甲']);
  assert.deepEqual(matchMentions('jia 超溫柔', S).sure, ['甲甲']);              // 不分大小寫
  assert.deepEqual(matchMentions('丙丙和甲甲都很親切', S).sure.sort(), ['丙丙', '甲甲'].sort()); // 多位各計一次
  assert.deepEqual(matchMentions('Yvonne!!', S).sure, ['乙乙']);               // 別名
  // 不確定 → 待處理
  assert.deepEqual(matchMentions('33 號的養護師很棒', S).unsure, [{ name: '甲甲', nick: '33' }]);
  assert.deepEqual(matchMentions('我今年 33 歲', S).unsure.map((u) => u.name), ['甲甲']);
  assert.deepEqual(matchMentions('Yi 很溫柔', S).unsure.map((u) => u.name), ['乙乙']);
  assert.deepEqual(matchMentions('Jiaying 很可愛', S).unsure, [{ name: '甲甲', nick: 'Jia' }, { name: '乙乙', nick: 'Yi' }]); // 英文只命中一部分 → 都列為候選
  assert.deepEqual(matchMentions('電話 1330 很好打', S).unsure, []);           // 數字夾在其他數字中間不算
  // 未指名
  assert.equal(matchMentions('不知道名字，但服務很好', S).anonymous, true);
  assert.equal(matchMentions('', S).anonymous, true);
  // 有內容但比對不到 → 不是未指名（交給待處理）
  const r = matchMentions('短髮的那位，很會聊天', S);
  assert.equal(r.anonymous, false);
  assert.deepEqual(r.sure, []);
});

test('星數與環境類關鍵字', () => {
  assert.equal(parseStars(0), null);
  assert.equal(parseStars('5'), 5);
  assert.equal(parseStars(''), null);
  assert.deepEqual(envFlag('廁所可以再多一間，冷氣有點冷'), ['廁所', '冷氣']);
  assert.deepEqual(envFlag('希望可以多聊天'), []);
});

test('欄位自動對應', () => {
  const m = guessSurveyMapping(SURVEY_HEADERS);
  assert.equal(m.mention, SURVEY_HEADERS[0]);
  assert.equal(m.stars, SURVEY_HEADERS[3]);
  assert.equal(m.date, '消費時間');
  assert.equal(checkSurveyMapping(SURVEY_HEADERS, m).ok, true);
});

test('30 筆假問卷：解析、待處理、未指名、負評、環境類', () => {
  const rows = fakeSurveyRows('2099-03');
  const { items, months } = parseSurvey(rows, { mapping: guessSurveyMapping(rows[0]), staff: S });
  assert.equal(items.length, 30);
  assert.deepEqual(months, ['2099-03']);
  const count = (s) => items.filter((x) => x.status === s).length;
  assert.equal(count('matched') + count('pending') + count('anonymous'), 30);
  assert.ok(count('pending') >= 5, '應有數筆待處理');
  assert.ok(count('anonymous') >= 4, '應有數筆未指名');
  assert.ok(items.some((x) => x.stars === null), '0 星視為未評分');
  assert.ok(items.filter((x) => x.negative).every((x) => x.stars <= 3));
  assert.ok(items.some((x) => x.envKeywords.includes('廁所')));
});

test('待處理指定後統計點名數與平均星數', () => {
  const rows = fakeSurveyRows('2099-03');
  const { items } = parseSurvey(rows, { mapping: guessSurveyMapping(rows[0]), staff: S });
  const pending = items.filter((x) => x.status === 'pending');
  const decisions = Object.fromEntries(pending.map((x, i) => [x.id, i === 0 ? { staff: ['甲甲'] } : { anonymous: true }]));
  const res = resolveSurvey(items, decisions);
  assert.ok(res.every((x) => x.resolved));
  const st = surveyStats(res, '甲甲', ['2099-03']);
  assert.ok(st.mentions >= 8);
  assert.ok(st.avgStars >= 1 && st.avgStars <= 5);
  assert.ok(st.rated <= st.mentions);
  // 未處理的待處理 → resolved false
  assert.ok(resolveSurvey(items, {}).some((x) => !x.resolved));
});
