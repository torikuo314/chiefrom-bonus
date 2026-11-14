// 個人經營月報資料：假資料
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatement, buildCard, buildMix, lastMonths, CARD_DEFS, topRanks } from '../src/statement.js';

const P = { T1: 140000, T2: 220000, R1: 0.2, R2: 0.3 };
const rows = [
  { 月份: '2099-02', 養護師: '甲甲', 業績: '100000', 調整金額: '' },
  { 月份: '2099-03', 養護師: '甲甲', 業績: '150000', 調整金額: '10000', 第一級業績: '20000', 第二級業績: '0', 當月獎金: '4000' },
  { 月份: '2099-03', 養護師: '乙乙', 業績: '999999' },
];
const cur = {
  avgTicket: 4200, customers: 30, productRatio: 0.12,
  returnRate: { value: 0.55, smallSample: true, pending: false, baseMonth: '2099-01' },
  addonRate: { value: 0.3 }, mix: { 草本染髮: 90000, 頭皮護理: 30000, 商品: 18000, 加購服務: 2000, 低敏染髮: 10000 },
};
const prev = { avgTicket: 4000, customers: 33, productRatio: 0.1, returnRate: { value: 0.6 }, addonRate: { value: 0.3 } };

test('近 6 個月跨年', () => {
  assert.deepEqual(lastMonths('2099-02', 6), ['2098-09', '2098-10', '2098-11', '2098-12', '2099-01', '2099-02']);
});

test('指標卡：本月數值＋與自己上月比較', () => {
  const by = Object.fromEntries(CARD_DEFS.map((d) => [d.key, buildCard(d, cur, prev)]));
  assert.equal(by.avgTicket.value, '4,200');
  assert.equal(by.avgTicket.diff.text, '較上月 ↑ 200 元');
  assert.equal(by.customers.diff.text, '較上月 ↓ 3 人');
  assert.equal(by.customers.diff.dir, 'down');
  assert.equal(by.productRatio.value, '12%');
  assert.equal(by.productRatio.diff.text, '較上月 ↑ 2 個百分點');
  assert.equal(by.returnRate.diff.text, '較上月 ↓ 5 個百分點');
  assert.equal(by.returnRate.small, true);
  assert.equal(buildCard(CARD_DEFS[2], { returnRate: { value: 0.5 } }, { returnRate: { pending: true } }).diff, null); // 上月資料累積中 → 不比較
  assert.equal(by.addonRate.diff.text, '與上月持平');
  assert.equal(buildCard(CARD_DEFS[2], { returnRate: { pending: true } }, null).value, '資料累積中');
  assert.equal(CARD_DEFS.length, 5);
});

test('服務項目佔比：固定順序、其餘併為其他', () => {
  const m = buildMix(cur.mix);
  assert.deepEqual(m.items.map((x) => x.label), ['草本染髮', '頭皮護理', '商品', '加購服務', '其他']);
  assert.equal(m.total, 150000);
  assert.equal(m.items[0].percent, 60);
});

test('月報內容', () => {
  const s = buildStatement(rows, '甲甲', '2099-03', P, [], { cur, prev, radar: { sales: 60 }, praise: { mentions: 4, quotes: ['a', 'b', 'c', 'd'] } });
  assert.equal(s.sales, 160000);
  assert.equal(s.progress.text, '已達第一門檻，距第二門檻還差 60,000 元');
  assert.equal(s.estimatedBonus, 4000);
  assert.equal(s.cards.length, 5);
  assert.equal(s.cards.find((c) => c.key === 'returnRate').note, '1 月服務的客人，60 天內再回店的比例');
  assert.equal(s.smallSampleNote, true);
  assert.equal(s.trend[4].sales, 100000);
  assert.equal(s.praise.quotes.length, 3); // 最多 3 則
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, [], { cur, praise: { mentions: 0, quotes: [] } }).praise, null);
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, [], { cur, praise: { mentions: 2, quotes: [] } }).praise, null); // 有點名但沒勾選 → 隱藏
});

test('店內前三名：同分同名次、0% 不排名、第 4 名以後不顯示', () => {
  const r = topRanks([{ name: 'a', value: 0.3 }, { name: 'b', value: 0.3 }, { name: 'c', value: 0.2 }, { name: 'd', value: 0.1 }, { name: 'e', value: 0 }, { name: 'f', value: null }]);
  assert.deepEqual(r, { a: 1, b: 1, c: 3 });
  const s = buildStatement(rows, '甲甲', '2099-03', P, [], { cur, prev, ranks: { productRatio: 2 } });
  assert.equal(s.cards.find((c) => c.key === 'productRatio').rank, 2);
  assert.equal(s.cards.find((c) => c.key === 'addonRate').rank, null);
});

test('不含比例、級距業績或店內平均', () => {
  const s = buildStatement(rows, '甲甲', '2099-03', P, [], { cur, prev });
  const json = JSON.stringify(s);
  for (const banned of ['tier', 'R1', 'R2', '20000', '"0.2"', '0.3,', '第一級', '第二級', '平均']) {
    assert.ok(!json.includes(banned), `月報資料不應包含 ${banned}`);
  }
});

test('本季截至當月的累計預支', () => {
  const adv = [
    { 養護師: '甲甲', 日期: '2099-01-10', 金額: '5000', 扣抵季度: '2099-Q1' },
    { 養護師: '甲甲', 日期: '2099-03-02', 金額: '3000', 扣抵季度: '2099-Q1' },
    { 養護師: '甲甲', 日期: '2099-04-01', 金額: '9999', 扣抵季度: '2099-Q2' },
    { 養護師: '乙乙', 日期: '2099-02-01', 金額: '7777', 扣抵季度: '2099-Q1' },
  ];
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, adv).quarterAdvance, 8000);
  assert.equal(buildStatement(rows, '甲甲', '2099-02', P, adv).quarterAdvance, 5000);
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P).quarterAdvance, 0);
});
