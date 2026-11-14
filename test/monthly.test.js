// 假資料
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paramVersions, paramsFor, buildMonthlyRows, monthStatsFromLines, orderLineToSheetRow, orderLinesFromSheet, isQuarterLocked } from '../src/monthly.js';
import { localBackend } from '../src/backend.js';

const paramRows = [
  { 參數名稱: 'T1', 數值: '140000', 生效月份: '2099-01' },
  { 參數名稱: 'T2', 數值: '220000', 生效月份: '2099-01' },
  { 參數名稱: 'R1', 數值: '0.2', 生效月份: '2099-01' },
  { 參數名稱: 'R2', 數值: '0.3', 生效月份: '2099-01' },
  { 參數名稱: 'T1', 數值: '150,000', 生效月份: '2099-07' },
];

test('參數版本：只改一項時其他沿用', () => {
  const v = paramVersions(paramRows);
  assert.equal(v.length, 2);
  assert.deepEqual(v[1], { effectiveMonth: '2099-07', T1: 150000, T2: 220000, R1: 0.2, R2: 0.3 });
  assert.equal(paramsFor(paramRows, '2099-06').T1, 140000);
  assert.equal(paramsFor(paramRows, '2099-08').T1, 150000);
});

const P = paramsFor(paramRows, '2099-01');
// 訂單 line（orders.js 格式）
let no = 0;
const OL = (staff, role, amount, extra = {}) => ({ month: '2099-01', orderNo: `O${++no}`, lineNo: 1, date: '2099-01-10', store: '本館',
  customer: `c${no}`, category: '', type: '草本染髮', item: '', staff, role, amount, assist: 0, ...extra });

test('月業績統計：業績含助理列、商品／服務、筆數客數只看設計師', () => {
  const lines = [
    OL('甲甲', '設計師', 140000, { orderNo: 'A', customer: 'x' }), OL('甲甲', '設計師', 10000, { orderNo: 'A', customer: 'x', type: '商品' }),
    OL('甲甲', '助理', 1000), OL('甲甲', '設計師', 500, { store: '夥伴店' }), OL('甲甲', '設計師', 9, { month: '2099-02' }),
  ];
  const [s] = monthStatsFromLines(lines, '2099-01');
  assert.deepEqual(s, { name: '甲甲', sales: 151000, product: 10000, service: 141000, visits: 1, customers: 1, avgTicket: 150000 });
});

test('月業績：保留調整金額、業績變動時改回未確認', () => {
  const stats = monthStatsFromLines([OL('甲甲', '設計師', 150000), OL('甲甲', '助理', 1000)], '2099-01');
  const existing = [
    { 養護師: '甲甲', 業績: '100', 調整金額: '-1000', 確認狀態: '已確認' },
    { 養護師: '乙乙', 業績: '5000', 調整金額: '', 確認狀態: '未確認' },
  ];
  const { rows, changed } = buildMonthlyRows('2099-01', stats, existing, P);
  const jia = rows.find((r) => r['養護師'] === '甲甲');
  assert.equal(jia['業績'], 151000);
  assert.equal(jia['當月獎金'], 2000); // (151000-1000-140000)*0.2
  assert.equal(jia['確認狀態'], '未確認');
  assert.equal(jia['調整金額'], undefined); // 不覆寫手動欄位
  assert.deepEqual(changed, ['甲甲']);
  const yi = rows.find((r) => r['養護師'] === '乙乙');
  assert.equal(yi['業績'], 0); // 本月已無資料
});

test('月業績：業績沒變則不動確認狀態', () => {
  const stats = monthStatsFromLines([OL('甲甲', '設計師', 1000)], '2099-01');
  const { rows } = buildMonthlyRows('2099-01', stats, [{ 養護師: '甲甲', 業績: '1000', 確認狀態: '已確認' }], P);
  assert.equal(rows[0]['確認狀態'], undefined);
});

test('交易明細來回轉換', () => {
  const l = OL('甲甲', '助理', 300, { customer: '0900111222', category: '附加服務', type: '加購服務', assist: 50 });
  const row = orderLineToSheetRow(l, 'b1');
  assert.equal(row['手機'], '0900111222'); // 交給後端轉雜湊
  assert.equal(row['工作人員'], '甲甲');
  const sheetRow = Object.fromEntries(Object.entries({ ...row, 客人雜湊: 'h1' }).filter(([k]) => k !== '手機').map(([k, v]) => [k, String(v)]));
  const back = orderLinesFromSheet([sheetRow])[0];
  assert.equal(back.customer, 'h1');
  assert.equal(back.role, '助理');
  assert.equal(back.amount, 300);
  assert.equal(back.type, '加購服務');
  assert.equal(back.date, '2099-01-10');
});

test('季度鎖定判斷', () => {
  assert.equal(isQuarterLocked([{ 季度: '2099-Q1', 鎖定狀態: '已鎖定' }], '2099-02'), true);
  assert.equal(isQuarterLocked([{ 季度: '2099-Q1', 鎖定狀態: '已解鎖' }], '2099-02'), false);
});

test('本機測試模式後端語意', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const be = localBackend(storage);
  await assert.rejects(be.call('read', { sheets: ['月業績'] }), /初始化/);
  await be.call('init');
  await be.call('replace', { sheet: '交易明細', match: { 月份: '2099-01', 店家: '本館' }, rows: [{ 月份: '2099-01', 店家: '本館', 業績: 1 }] });
  const r = await be.call('replace', { sheet: '交易明細', match: { 月份: '2099-01', 店家: '本館' }, rows: [{ 月份: '2099-01', 店家: '本館', 業績: 2 }] });
  assert.equal(r.removed, 1);
  await assert.rejects(be.call('batch', { ops: [{ action: 'append', payload: { sheet: '交易明細', rows: [{}] } }, { action: 'nope' }] }));
  const d = await be.call('read', { sheets: ['交易明細'] });
  assert.equal(d['交易明細'].length, 1); // 失敗的 batch 不留半套寫入
  assert.equal(d['交易明細'][0]['業績'], '2');
});

test('手動調整重算獎金', async () => {
  const { recalcWithAdjustment, effectiveSales } = await import('../src/monthly.js');
  const row = { 業績: '150000', 客數: '10', 調整金額: '' };
  const r = recalcWithAdjustment(row, 10000, P);
  assert.deepEqual(r, { 調整金額: 10000, 第一級業績: 20000, 第二級業績: 0, 當月獎金: 4000 });
  assert.equal(effectiveSales({ ...row, ...r }), 160000);
  assert.equal(recalcWithAdjustment(row, -20000, P)['當月獎金'], 0);
});

test('本機測試模式：匯入訂單時手機轉雜湊', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const be = localBackend(storage);
  await be.call('init');
  await be.call('batch', { ops: [{ action: 'importOrders', payload: { months: ['2099-01'], rows: [{ 月份: '2099-01', 訂單號碼: 'A', 手機: '0900-123-456' }, { 月份: '2099-01', 訂單號碼: 'B', 手機: '0900123456' }] } }] });
  const d = (await be.call('read', { sheets: ['交易明細'] }))['交易明細'];
  assert.equal(d[0]['客人雜湊'].length, 32);
  assert.equal(d[0]['客人雜湊'], d[1]['客人雜湊']);
  assert.ok(!mem.get('chiefrom.localdb').includes('0900'));
});
