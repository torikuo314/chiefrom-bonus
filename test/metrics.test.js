// 經營指標測試：全部為假資料（假名、假手機、假金額）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, buildIndex, staffMonthMetrics, returnRate, newReturnRate,
  radarScores, declining, compare, lastDayOf, addMonths, addDays, daysBetween,
} from '../src/metrics.js';

let seq = 0;
const R = (date, customer, staff, amount, extra = {}) => ({
  orderNo: extra.orderNo || `O${++seq}`, lineNo: 1, date, store: '本館', customer, category: '', type: extra.type || '草本染髮',
  staff, role: '設計師', amount, assist: 0, ...extra,
});

test('日期工具', () => {
  assert.equal(lastDayOf('2099-02'), '2099-02-28');
  assert.equal(lastDayOf('2096-02'), '2096-02-29');
  assert.equal(addMonths('2099-01', -2), '2098-11');
  assert.equal(addDays('2099-12-31', 1), '2100-01-01');
  assert.equal(daysBetween('2099-01-01', '2099-03-02'), 60);
});

test('類別對照', () => {
  assert.equal(classify('商品'), '商品');
  assert.equal(classify('附加服務'), '加購服務');
  assert.equal(classify('方案Ａ'), '方案');
  assert.equal(classify('方案A+B'), '方案');
  assert.equal(classify('【草本染髮3-3.5hr】－適合白髮/敏感頭皮'), '草本染髮');
  assert.equal(classify('【頭皮護理2-2.5hr】－舒緩各種頭皮問題'), '頭皮護理');
  assert.equal(classify('【結構式護髮】－修護受損'), '護髮');
  assert.equal(classify('【低敏染髮】－布丁髮色'), '低敏染髮');
  assert.equal(classify(''), '其他');
});

// 老客準時回店：報表月 2099-10，基準月應為 2099-08（8/31 + 60 = 10/30 ≤ 10/31）
test('老客準時回店：60 天內／61 天／回到別人／手機空白', () => {
  const rows = [
    R('2099-07-01', 'z', '甲甲', 100),                  // 讓資料起始日早於基準月
    R('2099-08-01', 'c1', '甲甲', 100), R('2099-09-30', 'c1', '乙乙', 100), // 60 天，回到別人 → 算
    R('2099-08-02', 'c2', '甲甲', 100), R('2099-10-02', 'c2', '甲甲', 100), // 61 天 → 不算
    R('2099-08-03', 'c3', '甲甲', 100),                                       // 沒回來 → 不算
    R('2099-08-04', '', '甲甲', 100),                                         // 手機空白 → 不列入基準
    R('2099-08-05', 'c4', '甲甲', 100), R('2099-08-05', 'c4', '甲甲', 50),   // 同日兩張單：都算基準，但同日不算「回店」
    R('2099-08-20', 'c5', '乙乙', 100),                                       // 別人的客人 → 不列入甲甲基準
  ];
  const r = returnRate(buildIndex(rows), '甲甲', '2099-10');
  assert.equal(r.baseMonth, '2099-08');
  assert.equal(r.den, 5);
  assert.equal(r.num, 1);
  assert.equal(r.smallSample, false);
});

test('老客準時回店：資料不足時顯示資料累積中', () => {
  const rows = [R('2099-09-01', 'c1', '甲甲', 100)];
  const r = returnRate(buildIndex(rows), '甲甲', '2099-10');
  assert.equal(r.pending, true);
  assert.equal(r.value, null);
});

// 新客回店：報表月 2099-10 → 截止日 10/31−75 = 08/17；基準期間 05/18–08/17
test('新客回店：75 天內回店（任何人）、首次由別人接手不算、期間外不算', () => {
  const rows = [
    R('2099-01-05', 'old', '甲甲', 100),                                     // 資料起點
    R('2099-05-20', 'n1', '甲甲', 100), R('2099-08-03', 'n1', '乙乙', 100), // 75 天 → 算
    R('2099-06-01', 'n2', '甲甲', 100), R('2099-08-16', 'n2', '甲甲', 100), // 76 天 → 不算
    R('2099-07-01', 'n3', '乙乙', 100), R('2099-07-10', 'n3', '甲甲', 100), // 首次是乙乙 → 不是甲甲的新客
    R('2099-05-18', 'n4', '甲甲', 100),                                       // 期間第一天，沒回來
    R('2099-05-17', 'n5', '甲甲', 100), R('2099-05-30', 'n5', '甲甲', 100), // 期間外（不含起點）
    R('2099-08-18', 'n6', '甲甲', 100),                                       // 截止日之後
    R('2099-03-01', 'old', '甲甲', 100), R('2099-06-01', 'old', '甲甲', 100), // 老客不算新客
  ];
  const r = newReturnRate(buildIndex(rows), '甲甲', '2099-10');
  assert.deepEqual(r.window, { from: '2099-05', to: '2099-08' });
  assert.equal(r.den, 3);
  assert.equal(r.num, 1);
  assert.equal(r.smallSample, true);
});

test('新客回店：基準期間早於資料起始日 → 資料累積中', () => {
  const rows = [R('2099-06-01', 'n1', '甲甲', 100)];
  assert.equal(newReturnRate(buildIndex(rows), '甲甲', '2099-10').pending, true);
});

test('核心指標：業績含擔任助理、客單價／客數只看設計師、商品佔比、加購率', () => {
  const rows = [
    R('2099-03-01', 'a', '甲甲', 3000, { orderNo: 'X1', type: '草本染髮' }),
    R('2099-03-01', 'a', '甲甲', 1000, { orderNo: 'X1', type: '商品' }),
    R('2099-03-01', 'a', '丙丙', 300, { orderNo: 'X1', type: '加購服務', role: '設計師' }), // 同單別人做的加購
    R('2099-03-05', 'b', '甲甲', 2000, { orderNo: 'X2', type: '頭皮護理', assist: 400 }),
    R('2099-03-06', 'c', '乙乙', 2500, { orderNo: 'X3' }),
    R('2099-03-06', 'c', '甲甲', 400, { orderNo: 'X3', role: '助理' }),          // 甲甲當助理
    R('2099-03-07', '', '甲甲', 1500, { orderNo: 'X4', type: '方案' }),          // 手機空白：計業績，不計客數
    R('2099-03-08', 'd', '甲甲', 999, { orderNo: 'X5', store: '夥伴店' }),      // 夥伴店不計入
  ];
  const m = staffMonthMetrics(buildIndex(rows), '甲甲', '2099-03');
  assert.equal(m.sales, 3000 + 1000 + 2000 + 400 + 1500);
  assert.equal(m.orders, 3);
  assert.equal(m.avgTicket, (3000 + 1000 + 2000 + 1500) / 3);
  assert.equal(m.customers, 2);
  assert.equal(m.productRatio, 1000 / 7500);
  assert.equal(m.addonRate.value, 1 / 3);
  assert.deepEqual(m.asAssistant, { count: 1, amount: 400 });
  assert.deepEqual(m.assistUsed, { count: 1, amount: 400 });
  assert.equal(m.newCustomers, 2); // a、b 首次由甲甲擔任設計師
  assert.deepEqual(m.mix, { 草本染髮: 3000, 商品: 1000, 頭皮護理: 2000, 方案: 1500 });
});

test('雷達分數：50 × 個人 ÷ 店內平均，上限 100，只用納入比較者算平均', () => {
  const list = [
    { staff: '甲甲', sales: 200000, avgTicket: 4000, returnRate: { value: null, pending: true }, productRatio: 0.1 },
    { staff: '乙乙', sales: 100000, avgTicket: 2000, returnRate: { value: 0.5 }, productRatio: 0 },
    { staff: '老闆', sales: 900000, avgTicket: 9000, returnRate: { value: 0.9 }, productRatio: 0.9 },
  ];
  const s = radarScores(list, ['甲甲', '乙乙']);
  assert.equal(s['甲甲'].sales, 67);     // 50 × 200000 / 150000
  assert.equal(s['乙乙'].sales, 33);
  assert.equal(s['甲甲'].returnRate, null); // 資料累積中
  assert.equal(s['乙乙'].returnRate, 50);
  assert.deepEqual(Object.keys(s['甲甲']), ['sales', 'avgTicket', 'returnRate', 'productRatio']); // 4 軸
  assert.equal(s['甲甲'].productRatio, 100);
  assert.equal(s['乙乙'].productRatio, 0);
  assert.equal(s['老闆'].sales, 100);     // 上限 100
});

test('與上月比較、連續 3 個月下滑', () => {
  assert.equal(compare({ value: 0.5 }, { value: 0.4 }).toFixed(2), '0.10');
  assert.equal(compare(100, null), null);
  assert.equal(declining([10, 9, 8, 7]), true);
  assert.equal(declining([10, 9, 9, 7]), false);
  assert.equal(declining([9, 8, 7]), false); // 不足 4 個月
  assert.equal(declining([{ value: 0.5 }, { value: 0.4 }, { value: 0.3 }, { value: 0.2 }]), true);
});

test('居家產品推薦＝擔任設計師訂單中的商品業績', () => {
  const rows = [
    R('2099-03-01', 'a', '甲甲', 3000, { orderNo: 'P1' }), R('2099-03-01', 'a', '甲甲', 1200, { orderNo: 'P1', type: '商品' }),
    R('2099-03-02', 'b', '甲甲', 800, { orderNo: 'P2', type: '商品' }), R('2099-03-03', 'c', '甲甲', 500, { orderNo: 'P3', type: '商品', role: '助理' }),
  ];
  assert.equal(staffMonthMetrics(buildIndex(rows), '甲甲', '2099-03').productSales, 2000);
});
