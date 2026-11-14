// 待回訪名單（假資料）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/metrics.js';
import { revisitList, revisitText } from '../src/revisit.js';

let n = 0;
const R = (date, customer, staff, extra = {}) => ({ orderNo: extra.orderNo || `O${++n}`, lineNo: 1, date, store: '本館', customer, category: '', type: '草本染髮', item: '補染', staff, role: '設計師', amount: 3000, assist: 0, ...extra });

test('超過天數、最後一次由本人服務才列入', () => {
  const rows = [
    R('2099-01-10', 'a', '甲甲'),                          // 最後一次 01-10，到 03-31 已 80 天 → 列入
    R('2099-01-05', 'b', '甲甲'), R('2099-03-01', 'b', '乙乙'), // 最後一次由乙乙服務 → 甲甲不列
    R('2099-03-20', 'c', '甲甲'),                          // 11 天 → 未到
    R('2098-06-01', 'd', '甲甲'),                          // 超過 180 天 → 不列
    R('2099-02-01', 'e', '甲甲', { orderNo: 'X9' }), R('2099-02-01', 'e', '甲甲', { orderNo: 'X9', type: '商品', item: '養髮液' }),
    R('2099-02-01', '', '甲甲'),                           // 沒有手機 → 無法追蹤
  ];
  const list = revisitList(buildIndex(rows), '甲甲', '2099-03-31', { days: 45, maxDays: 180 });
  assert.deepEqual(list.map((x) => x.daysSince), [58, 80]);
  assert.equal(list[0].orderNo, 'X9');
  assert.deepEqual(list[0].items, ['草本染髮・補染', '商品・養髮液']);
  assert.equal(revisitList(buildIndex(rows), '乙乙', '2099-03-31').length, 0); // b 才 30 天
  const text = revisitText('甲甲', list, '2099-03-31', 45);
  assert.match(text, /訂單 X9（2099-02-01，58 天前）/);
  assert.ok(!/09\d{8}/.test(text));
});
