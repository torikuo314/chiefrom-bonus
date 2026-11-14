// 假資料
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatement, lastMonths } from '../src/statement.js';

const P = { T1: 140000, T2: 220000, R1: 0.2, R2: 0.3 };
const rows = [
  { 月份: '2099-02', 養護師: '甲甲', 業績: '100000', 調整金額: '' },
  { 月份: '2099-03', 養護師: '甲甲', 業績: '150000', 調整金額: '10000', 服務業績: '140000', 商品業績: '10000',
    筆數: '50', 客數: '20', 第一級業績: '20000', 第二級業績: '0', 當月獎金: '4000' },
  { 月份: '2099-03', 養護師: '乙乙', 業績: '999999' },
];

test('近 6 個月跨年', () => {
  assert.deepEqual(lastMonths('2099-02', 6), ['2098-09', '2098-10', '2098-11', '2098-12', '2099-01', '2099-02']);
});

test('明細內容', () => {
  const s = buildStatement(rows, '甲甲', '2099-03', P);
  assert.equal(s.sales, 160000);
  assert.equal(s.progress.text, '已達第一門檻');
  assert.deepEqual(s.mix, { service: 140000, product: 10000 });
  assert.equal(s.trend.length, 6);
  assert.equal(s.trend[4].sales, 100000);
  assert.equal(s.trend[3].sales, null);
  assert.deepEqual(s.metrics, { visits: 50, customers: 20, avgTicket: 8000, momPercent: 60 });
});

test('顯示預估獎金，但不含比例或級距業績', () => {
  const s = buildStatement(rows, '甲甲', '2099-03', P);
  const json = JSON.stringify(s);
  assert.equal(s.estimatedBonus, 4000);
  for (const banned of ['tier', 'R1', 'R2', '20000', '0.2', '0.3', '第一級', '第二級']) {
    assert.ok(!json.includes(banned), `明細資料不應包含 ${banned}`);
  }
});

test('沒有上月資料時不顯示比較', () => {
  const s = buildStatement(rows, '甲甲', '2099-02', P);
  assert.equal(s.metrics.momPercent, null);
  assert.equal(s.progress.text, '距第一門檻還差 40,000 元');
});

test('本季截至當月的累計預支', () => {
  const adv = [
    { 養護師: '甲甲', 日期: '2099-01-10', 金額: '5000', 扣抵季度: '2099-Q1' },
    { 養護師: '甲甲', 日期: '2099-03-02', 金額: '3000', 扣抵季度: '2099-Q1' },
    { 養護師: '甲甲', 日期: '2099-04-01', 金額: '9999', 扣抵季度: '2099-Q2' }, // 下一季
    { 養護師: '乙乙', 日期: '2099-02-01', 金額: '7777', 扣抵季度: '2099-Q1' }, // 別人
  ];
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, adv).quarterAdvance, 8000);
  assert.equal(buildStatement(rows, '甲甲', '2099-02', P, adv).quarterAdvance, 5000); // 3 月的還沒發生
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P).quarterAdvance, 0);
});
