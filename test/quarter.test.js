// 假資料
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuarter, defaultPayDate, prevQuarter, nextQuarter, settlementRows, quarterRules } from '../src/quarter.js';
import { monthlyBonus, DEFAULT_PARAMS } from '../src/calc.js';

const params = [
  { 參數名稱: 'T1', 數值: '140000', 生效月份: '2099-01' }, { 參數名稱: 'T2', 數值: '220000', 生效月份: '2099-01' },
  { 參數名稱: 'R1', 數值: '0.2', 生效月份: '2099-01' }, { 參數名稱: 'R2', 數值: '0.3', 生效月份: '2099-01' },
];
const mrow = (m, name, sales, status = '已確認') => {
  const b = monthlyBonus(sales, DEFAULT_PARAMS);
  return { 月份: m, 養護師: name, 業績: String(sales), 調整金額: '', 第一級業績: String(b.tier1), 第二級業績: String(b.tier2), 當月獎金: String(b.bonus), 確認狀態: status };
};
const base = () => ({
  月業績: [mrow('2099-04', '甲甲', 250000), mrow('2099-05', '甲甲', 150000), mrow('2099-06', '甲甲', 100000), mrow('2099-04', '乙乙', 160000)],
  預支: [{ 編號: 'a1', 日期: '2099-05-02', 養護師: '甲甲', 金額: '40000', 備註: '', 已簽同意書: '是', 扣抵季度: '2099-Q2' }],
  季結算: [],
  參數: params,
});

test('季度與發放日期', () => {
  assert.equal(prevQuarter('2099-Q1'), '2098-Q4');
  assert.equal(nextQuarter('2099-Q4'), '2100-Q1');
  assert.equal(defaultPayDate('2099-Q4'), '2100-01-15');
  assert.equal(defaultPayDate('2099-Q2'), '2099-07-15');
});

test('§5.3 季結算案例（經由完整流程）', () => {
  const q = buildQuarter(base(), '2099-Q2');
  assert.deepEqual(q.blockers, []);
  const jia = q.staff.find((s) => s.name === '甲甲');
  assert.equal(jia.quarterBonus, 27000);
  assert.equal(jia.payout, 0);
  assert.equal(jia.carryOut, 13000);
  const yi = q.staff.find((s) => s.name === '乙乙');
  assert.equal(yi.quarterBonus, 4000);
  assert.equal(yi.months[1].noData, true);
});

test('上季結轉、未確認阻擋、未簽警告', () => {
  const db = base();
  db['季結算'].push({ 季度: '2099-Q1', 養護師: '乙乙', 結轉下季: '1500', 結算日期: '2099-04-10' });
  db['月業績'][3]['確認狀態'] = '有異議';
  db['預支'].push({ 編號: 'a2', 日期: '2099-06-01', 養護師: '乙乙', 金額: '500', 已簽同意書: '否', 扣抵季度: '2099-Q2' });
  const q = buildQuarter(db, '2099-Q2');
  assert.equal(q.blockers.length, 1);
  assert.match(q.blockers[0], /乙乙 2099-04（有異議）/);
  assert.ok(q.warnings.some((w) => /未簽同意書/.test(w)));
  const yi = q.staff.find((s) => s.name === '乙乙');
  assert.equal(yi.carryIn, 1500);
  assert.equal(yi.payout, 4000 - 1500 - 500);
});

test('缺月份要阻擋、上季未結算要警告', () => {
  const db = base();
  db['月業績'] = db['月業績'].filter((r) => r['月份'] !== '2099-06');
  db['月業績'].push(mrow('2099-03', '甲甲', 100000));
  const q = buildQuarter(db, '2099-Q2');
  assert.ok(q.blockers.some((b) => /尚未匯入：2099-06/.test(b)));
  assert.ok(q.warnings.some((w) => /2099-Q1 尚未結算/.test(w)));
});

test('只有結轉、沒有業績的人也要列入', () => {
  const db = base();
  db['季結算'].push({ 季度: '2099-Q1', 養護師: '丙丙', 結轉下季: '3000', 結算日期: '2099-04-10' });
  const c = buildQuarter(db, '2099-Q2').staff.find((s) => s.name === '丙丙');
  assert.equal(c.carryOut, 3000);
});

test('結算列與參數說明', () => {
  const q = buildQuarter(base(), '2099-Q2');
  const rows = settlementRows(q, { today: '2099-07-01', payDate: '2099-07-15' });
  assert.equal(rows.find((r) => r['養護師'] === '甲甲')['結轉下季'], 13000);
  assert.equal(rows[0]['鎖定狀態'], '已鎖定');
  const rules = quarterRules([...params, { 參數名稱: 'T1', 數值: '150000', 生效月份: '2099-06' }], ['2099-04', '2099-05', '2099-06']);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].months, ['2099-04', '2099-05']);
  assert.equal(rules[1].T1, 150000);
});

test('季度經營回顧：三個月彙總與上季比較', async () => {
  const { quarterAggregate, buildReview } = await import('../src/quarter.js');
  const m = (sales, avgTicket, orders, customers, num, den, pc, ac) => ({ sales, avgTicket, orders, customers, returnRate: { value: num / den, num, den }, productSales: pc, addonCount: ac });
  const cur = quarterAggregate([m(100000, 4000, 25, 20, 5, 10, 3, 4), m(120000, 5000, 24, 22, 6, 10, 4, 5), m(0, null, 0, 0, 0, 0, 0, 0)]);
  assert.equal(cur.sales, 220000);
  assert.equal(cur.avgTicket, Math.round((4000 * 25 + 5000 * 24) / 49));
  assert.equal(cur.customers, 42);
  assert.equal(cur.returnRate.value, 11 / 20);
  assert.equal(cur.productSales, 7);
  const prev = quarterAggregate([m(90000, 4000, 20, 18, 4, 10, 2, 6)]);
  const r = buildReview({ name: '甲甲', quarter: '2099-Q2', cur, prev, quotes: ['a', 'b', 'c', 'd', 'e'], feedback: ' 表現穩定 ', goals: '回流率 60%' });
  const by = Object.fromEntries(r.items.map((x) => [x.key, x]));
  assert.equal(by.sales.diff.text, '多 130,000 元');
  assert.equal(by.returnRate.value, '55%');
  assert.equal(by.returnRate.diff.text, '多 7 人次回流');
  assert.equal(by.addonCount.diff.text, '多 3 次');
  assert.equal(r.quotes.length, 4);
  assert.equal(r.feedback, '表現穩定');
  assert.equal(quarterAggregate([null, { sales: 0 }]), null); // 沒資料
  assert.equal(buildReview({ name: '甲甲', quarter: 'q', cur, prev: null }).items[0].diff, null);
});
