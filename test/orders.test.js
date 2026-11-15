// 神美訂單列表解析：自行產生的假資料（假名、假手機）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrders, applyDecisions, orderSummary, toDate, checkOrderMapping, DEFAULT_ORDER_MAPPING } from '../src/orders.js';
import { buildResolver } from '../src/importer.js';

const H = ['項次', '訂單號碼', '訂單時間', '建立時間', '店家', '會員', '手機', '備註', '定價', '實收', '發票', '統編', '分類', '品項', '數量', '總價', '折扣', '工作人員', '職位', '指定', '業績', '提成', '項目協助', '消費方式', '支付方式', '手續費'];
const row = (o) => H.map((h) => o[h] ?? null);
const base = { 店家: '頭沐｜本館', 手機: '0900-000-001', 職位: '設計師', 指定: '指定' };
const rows = [
  H,
  row({ ...base, 訂單號碼: 'A1', 訂單時間: '2099-01-14 12:27', 分類: '【草本染髮】－適合白髮', 工作人員: '甲甲', 業績: 2280, 項目協助: 300 }),
  row({ ...base, 訂單號碼: 'A1', 訂單時間: '2099-01-14 12:27', 分類: '附加服務', 工作人員: '甲甲', 業績: 509 }),
  row({ ...base, 訂單號碼: 'A1', 訂單時間: '2099-01-14 12:27', 分類: '【草本染髮】－適合白髮', 工作人員: '乙乙', 職位: '助理', 業績: 300 }),
  row({ ...base, 訂單號碼: 'A2', 訂單時間: '2099/2/3 10:00', 分類: '商品', 工作人員: '甲甲 設計師', 業績: '1,330' }),
  row({ ...base, 訂單號碼: 'A3', 訂單時間: '2099-02-05 11:00', 分類: '商品', 工作人員: null, 業績: null }),        // 工作人員空白
  row({ ...base, 訂單號碼: 'A4', 訂單時間: '2099-02-06 11:00', 店家: '夥伴店', 分類: '經銷商', 工作人員: null }), // 夥伴店
  row({ ...base, 訂單號碼: 'A5', 訂單時間: '2099-02-07 11:00', 分類: '方案Ｂ', 工作人員: '老闆', 業績: 5000 }),     // 固定排除
  row({ ...base, 訂單號碼: 'A6', 訂單時間: '2099-02-08 11:00', 分類: '方案Ａ', 工作人員: '新人', 業績: 800 }),      // 名單外
  row({ ...base, 訂單號碼: 'A6', 訂單時間: '2099-02-08 11:00', 分類: '商品', 工作人員: '新人', 業績: 200 }),
];
const resolve = buildResolver([{ name: '甲甲', aliases: [] }, { name: '乙乙', aliases: [] }], ['老闆']);

test('日期解析', () => {
  assert.equal(toDate('2099-01-14 12:27'), '2099-01-14');
  assert.equal(toDate('2099/2/3 10:00'), '2099-02-03');
  assert.equal(toDate(45306), '2024-01-15'); // Excel 序號
  assert.equal(toDate(''), null);
});

test('欄位對應檢查', () => {
  assert.equal(checkOrderMapping(H, DEFAULT_ORDER_MAPPING).ok, true);
  assert.deepEqual(checkOrderMapping(H.filter((h) => h !== '業績'), DEFAULT_ORDER_MAPPING).missing, ['業績']);
});

test('解析：列序、類別、職位、排除與待處理', () => {
  const p = parseOrders(rows, { resolve });
  assert.deepEqual(p.months, ['2099-01', '2099-02']);
  const a1 = p.lines.filter((l) => l.orderNo === 'A1');
  assert.deepEqual(a1.map((l) => l.lineNo), [1, 2, 3]);
  assert.equal(a1[0].key, '頭沐｜本館#A1#1');
  assert.deepEqual(a1.map((l) => l.type), ['草本染髮', '加購服務', '草本染髮']);
  assert.equal(a1[2].role, '助理');
  assert.equal(a1[0].assist, 300);
  assert.equal(a1[0].customer, '0900000001'); // 只留數字
  assert.equal(p.lines.find((l) => l.orderNo === 'A2').amount, 1330);
  assert.equal(p.lines.find((l) => l.orderNo === 'A2').staff, '甲甲');
  assert.deepEqual(p.excluded.map((e) => e.reason), ['工作人員空白', '工作人員空白', '固定排除']);
  assert.equal(p.lines.filter((l) => l.status === 'pending').length, 2);
});

test('同一檔案重複的列不重複計算', () => {
  const p = parseOrders([H, rows[1], rows[1]], { resolve });
  // 同訂單第二次出現會被當成第 2 列（品項列序不同），屬正常多品項；完全相同的鍵才算重複
  assert.equal(p.lines.length, 2);
  assert.equal(p.duplicates.length, 0);
});

test('待處理：以名稱一次指定歸屬或排除；摘要', () => {
  const p = parseOrders(rows, { resolve });
  const before = applyDecisions(p, {});
  assert.equal(before.pending.length, 2);
  const s0 = orderSummary(p, before);
  assert.deepEqual(s0.pendingNames, [{ name: '新人', rows: 2, amount: 1000 }]);

  const after = applyDecisions(p, { 新人: { assignTo: '乙乙' } });
  assert.equal(after.pending.length, 0);
  const s = orderSummary(p, after);
  assert.equal(s.byMonth['2099-01'].staff['甲甲'], 2280 + 509);
  assert.equal(s.byMonth['2099-01'].staff['乙乙'], 300);
  assert.equal(s.byMonth['2099-02'].staff['甲甲'], 1330);
  assert.equal(s.byMonth['2099-02'].staff['乙乙'], 1000);
  assert.equal(s.byMonth['2099-02'].excluded, 5000);

  const ex = applyDecisions(p, { 新人: { exclude: true } });
  assert.equal(ex.excluded.filter((e) => e.reason === '手動排除').length, 2);
});

test('多個檔案期間重疊時去重', async () => {
  const { mergeParsed } = await import('../src/orders.js');
  const a = parseOrders(rows, { resolve });
  const b = parseOrders([H, rows[1], rows[2], rows[4]], { resolve }); // A1 前兩列、A2 再出現一次
  const m = mergeParsed([a, b]);
  assert.equal(m.lines.length, a.lines.length);
  assert.equal(m.duplicates.length, 3);
});

test('商品券兌換的商品不算商品銷售（但仍是業績）', async () => {
  const { voucherAmount } = await import('../src/orders.js');
  assert.equal(voucherAmount('儲值金：1380、商品券：2,300'), 2300);
  assert.equal(voucherAmount('現場付款：500'), 0);
  const rs = [
    H,
    row({ ...base, 訂單號碼: 'V1', 訂單時間: '2099-03-01', 分類: '商品', 工作人員: '甲甲', 業績: 2150, 消費方式: '商品券：2300' }),
    row({ ...base, 訂單號碼: 'V2', 訂單時間: '2099-03-02', 分類: '【草本染髮】－x', 工作人員: '甲甲', 業績: 3000, 消費方式: '儲值金：1380、商品券：1200' }),
    row({ ...base, 訂單號碼: 'V2', 訂單時間: '2099-03-02', 分類: '商品', 工作人員: '甲甲', 業績: 1200 }),
    row({ ...base, 訂單號碼: 'V2', 訂單時間: '2099-03-02', 分類: '商品', 工作人員: '甲甲', 業績: 800 }),
    row({ ...base, 訂單號碼: 'V3', 訂單時間: '2099-03-03', 分類: '商品', 工作人員: '甲甲', 業績: 900, 消費方式: '現場付款：900' }),
  ];
  const p = parseOrders(rs, { resolve });
  assert.deepEqual(p.lines.map((l) => l.type), ['商品券兌換', '草本染髮', '商品券兌換', '商品', '商品']);
  assert.equal(p.lines.reduce((a, l) => a + l.amount, 0), 2150 + 3000 + 1200 + 800 + 900); // 業績不變
});

test('不同門店的相同訂單號碼不會混在一起', async () => {
  const { mergeParsed } = await import('../src/orders.js');
  const a = parseOrders([H, row({ ...base, 店家: '本館', 訂單號碼: 'S1', 訂單時間: '2099-03-01', 分類: '商品', 工作人員: '甲甲', 業績: 2000, 消費方式: '商品券：2000' })], { resolve });
  const b = parseOrders([H, row({ ...base, 店家: '二館', 訂單號碼: 'S1', 訂單時間: '2099-03-01', 分類: '商品', 工作人員: '甲甲', 業績: 900, 消費方式: '現場付款：900' })], { resolve });
  const m = mergeParsed([a, b]);
  assert.equal(m.lines.length, 2);                 // 不會被當成重複
  assert.deepEqual(m.lines.map((l) => l.type), ['商品券兌換', '商品']);
  const one = parseOrders([H, a.lines.length && row({ ...base, 店家: '本館', 訂單號碼: 'S1', 訂單時間: '2099-03-01', 分類: '商品', 工作人員: '甲甲', 業績: 2000, 消費方式: '商品券：2000' }),
    row({ ...base, 店家: '二館', 訂單號碼: 'S1', 訂單時間: '2099-03-01', 分類: '商品', 工作人員: '甲甲', 業績: 900, 消費方式: '現場付款：900' })], { resolve });
  assert.deepEqual(one.lines.map((l) => [l.store, l.lineNo, l.type]), [['本館', 1, '商品券兌換'], ['二館', 1, '商品']]);
});

test('商品券優先對應金額剛好的品項（不是照順序扣）', () => {
  const rs = [
    H,
    row({ ...base, 訂單號碼: 'W1', 訂單時間: '2099-03-15', 分類: '商品', 品項: '洗髮慕斯', 工作人員: '甲甲', 業績: 1700, 消費方式: '儲值金：2209、商品券：2300' }),
    row({ ...base, 訂單號碼: 'W1', 訂單時間: '2099-03-15', 分類: '商品', 品項: '贈品', 工作人員: '甲甲', 業績: 0 }),
    row({ ...base, 訂單號碼: 'W1', 訂單時間: '2099-03-15', 分類: '商品', 品項: '寵愛方案', 工作人員: '甲甲', 業績: 2300 }),
  ];
  const p = parseOrders(rs, { resolve });
  assert.deepEqual(p.lines.map((l) => [l.item, l.type]), [['洗髮慕斯', '商品'], ['贈品', '商品'], ['寵愛方案', '商品券兌換']]);
});
