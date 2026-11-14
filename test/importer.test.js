// 全部為假資料（假名、假金額），不含任何真實業績。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAPPING, detectMonths, checkMapping, splitNameRole, buildResolver,
  parseSummary, aggregate, summarize, findConflict, rowKey,
} from '../src/importer.js';

const H = ['人員代碼', '工作人員', '總服務實業績', '商品銷售實業績', '總客次', '總客數', '其他欄'];
const staff = [
  { name: '甲甲', aliases: ['王甲甲'] },
  { name: '乙乙', aliases: [] },
];
const resolve = buildResolver(staff, ['老闆']);

const storeA = [
  H,
  ['01', '甲甲 設計師', 100000, 10000, 50, 30, 9],
  ['02', '乙乙 設計師', 80000, 0, 40, 20, 9],
  ['01', '甲甲 助理', 1000, 0, 5, 5, 9],
  ['09', '老闆 設計師', 5000, 0, 3, 3, 9],
  ['10', '路人 助理', 700, 0, 2, 2, 9],
  [null, null, null, null, null, null, null],
];
const storeB = [
  H,
  ['01', '王甲甲', 20000, '1,500', 10, 8, 9],
  ['02', '', 300, 0, 1, 1, 9],
];

test('從工作表名稱判斷月份', () => {
  assert.deepEqual(detectMonths('2099年10月01日至2099年10月31日'), ['2099-10']);
  assert.deepEqual(detectMonths('業績_2099_11_20_至_2099_12_10'), ['2099-11', '2099-12']);
  assert.deepEqual(detectMonths('2099年12月20日至2100年01月05日'), ['2099-12', '2100-01']);
  assert.deepEqual(detectMonths('沒有日期'), []);
});

test('欄位對應檢查', () => {
  assert.equal(checkMapping(H, DEFAULT_MAPPING).ok, true);
  const r = checkMapping(['工作人員', '金額'], DEFAULT_MAPPING);
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('服務業績'));
});

test('姓名與身分拆分', () => {
  assert.deepEqual(splitNameRole('甲甲 設計師'), { base: '甲甲', role: '設計師' });
  assert.deepEqual(splitNameRole(' Amy  助理 '), { base: 'Amy', role: '助理' });
  assert.deepEqual(splitNameRole('王甲甲'), { base: '王甲甲', role: '' });
});

test('別名、固定排除、待處理', () => {
  assert.equal(resolve('王甲甲').name, '甲甲');
  assert.equal(resolve('甲甲 助理').status, 'staff');
  assert.equal(resolve('老闆 設計師').status, 'excluded');
  assert.equal(resolve('路人 助理').status, 'pending');
});

test('兩店加總、助理併入業績、客數只算設計師列', () => {
  const a = parseSummary(storeA, { mapping: DEFAULT_MAPPING, store: '本館', resolve });
  const b = parseSummary(storeB, { mapping: DEFAULT_MAPPING, store: '二館', resolve });
  const lines = [...a.lines, ...b.lines];
  assert.equal(lines.length, 7); // 空白列略過

  const agg = aggregate(lines);
  const jia = agg.staff.find((s) => s.name === '甲甲');
  assert.equal(jia.sales, 100000 + 10000 + 1000 + 20000 + 1500);
  assert.equal(jia.service, 121000);
  assert.equal(jia.product, 11500);
  assert.equal(jia.visits, 50 + 10); // 助理列不計；無身分後綴的列計入
  assert.equal(jia.customers, 30 + 8);
  assert.deepEqual(jia.byStore, { 本館: 111000, 二館: 21500 });
  assert.equal(agg.excluded.length, 1);
  assert.equal(agg.pending.length, 2); // 路人、空白姓名 → 不可默默略過
});

test('待處理可指定歸屬或排除', () => {
  const a = parseSummary(storeA, { mapping: DEFAULT_MAPPING, store: '本館', resolve });
  const b = parseSummary(storeB, { mapping: DEFAULT_MAPPING, store: '二館', resolve });
  const lines = [...a.lines, ...b.lines];
  const [p1, p2] = aggregate(lines).pending;
  const agg = aggregate(lines, { decisions: { [rowKey(p1)]: { assignTo: '乙乙' }, [rowKey(p2)]: { exclude: true } } });
  assert.equal(agg.pending.length, 0);
  assert.equal(agg.staff.find((s) => s.name === '乙乙').sales, 80700);

  const s = summarize(lines, agg);
  assert.equal(s.total, s.staffTotal + s.excludedTotal + s.pendingTotal);
  assert.equal(s.byStore['本館'].rows, 5);
});

test('同月同店重複匯入要偵測', () => {
  const batches = [{ month: '2099-10', store: '本館', batchId: 'x' }];
  assert.ok(findConflict(batches, '2099-10', '本館'));
  assert.equal(findConflict(batches, '2099-10', '二館'), null);
});
