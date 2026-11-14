// 測試一律用假資料（規格 §11）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS, monthlyBonus, quarterSettlement, paramsForMonth,
  targetProgress, quarterOf, monthsOfQuarter,
} from '../src/calc.js';

test('§5.3 每月獎金驗收案例', () => {
  const cases = [
    [100000, 0, 0, 0],
    [140000, 0, 0, 0],
    [150000, 10000, 0, 2000],
    [220000, 80000, 0, 16000],
    [250000, 80000, 30000, 25000],
  ];
  for (const [sales, tier1, tier2, bonus] of cases) {
    assert.deepEqual(monthlyBonus(sales, DEFAULT_PARAMS), { sales, tier1, tier2, bonus }, `業績 ${sales}`);
  }
});

test('§5.3 季結算驗收案例', () => {
  const months = [250000, 150000, 100000].map((s, i) => ({
    month: `2099-0${i + 1}`, bonus: monthlyBonus(s, DEFAULT_PARAMS).bonus, confirmed: true,
  }));
  const r = quarterSettlement({ months, carryIn: 0, advances: [{ amount: 40000, signed: true }] });
  assert.equal(r.quarterBonus, 27000);
  assert.equal(r.payout, 0);
  assert.equal(r.carryOut, 13000);
});

test('季結算：有未確認月份要阻擋', () => {
  const months = [{ month: '2099-01', bonus: 100, confirmed: true }, { month: '2099-02', bonus: 0, confirmed: false }];
  assert.throws(() => quarterSettlement({ months }), (e) => e.code === 'UNCONFIRMED' && e.months[0] === '2099-02');
});

test('季結算：未簽同意書的預支會被列出', () => {
  const months = [{ month: '2099-01', bonus: 5000, confirmed: true }];
  const r = quarterSettlement({ months, carryIn: 1000, advances: [{ amount: 1000, signed: false }] });
  assert.equal(r.payout, 3000);
  assert.equal(r.unsignedAdvances.length, 1);
});

test('四捨五入到元', () => {
  const p = { T1: 0, T2: 1e9, R1: 0.15, R2: 0 };
  assert.equal(monthlyBonus(10, p).bonus, 2); // 1.5 → 2
  assert.equal(monthlyBonus(9, p).bonus, 1); // 1.35 → 1
});

test('參數依生效月份取用', () => {
  const versions = [
    { effectiveMonth: '2099-01', T1: 140000, T2: 220000, R1: 0.2, R2: 0.3 },
    { effectiveMonth: '2099-07', T1: 150000, T2: 230000, R1: 0.2, R2: 0.3 },
  ];
  assert.equal(paramsForMonth(versions, '2099-06').T1, 140000);
  assert.equal(paramsForMonth(versions, '2099-07').T1, 150000);
  assert.equal(paramsForMonth(versions, '2100-01').T1, 150000);
  assert.throws(() => paramsForMonth(versions, '2098-12'));
});

test('目標進度文字不含金額與比例', () => {
  assert.equal(targetProgress(100000, DEFAULT_PARAMS).text, '距第一門檻還差 40,000 元');
  assert.equal(targetProgress(140000, DEFAULT_PARAMS).text, '已達第一門檻，距第二門檻還差 80,000 元');
  assert.equal(targetProgress(230000, DEFAULT_PARAMS).text, '已達第二門檻');
});

test('季度換算', () => {
  assert.equal(quarterOf('2099-10'), '2099-Q4');
  assert.deepEqual(monthsOfQuarter('2099-Q2'), ['2099-04', '2099-05', '2099-06']);
});
