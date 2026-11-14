// 用假的 SpreadsheetApp 在 Node 裡執行 Code.gs，驗證後端邏輯（假資料）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas as load } from './fake-gas.js';

test('token 驗證', () => {
  const { call } = load();
  assert.equal(call('ping', {}, 'wrong').ok, false);
  assert.equal(call('ping', {}).ok, true);
  const weak = load('short');
  assert.match(weak.call('ping', {}, 'short').error, /TOKEN/);
});

test('初始化建立所有分頁與預設參數，可重複執行', () => {
  const { call, sheets } = load();
  const r = call('init', {});
  assert.equal(r.ok, true);
  assert.equal(r.data.created.length, 8);
  assert.deepEqual(sheets['參數'].d.length, 5);
  call('init', {});
  assert.deepEqual(sheets['參數'].d.length, 5); // 不重複寫入
  const p = call('read', { sheets: ['參數'] }).data['參數'];
  assert.deepEqual(p[0], { 參數名稱: 'T1', 數值: '140000', 生效月份: '2026-01' });
});

test('replace：同月同店覆蓋，不重複累加', () => {
  const { call } = load();
  call('init', {});
  const rows = (store, amt) => [{ 月份: '2099-10', 門店: store, 養護師: '甲甲', 金額: amt }];
  call('replace', { sheet: '交易明細', match: { 月份: '2099-10', 門店: '本館' }, rows: rows('本館', 100) });
  call('replace', { sheet: '交易明細', match: { 月份: '2099-10', 門店: '二館' }, rows: rows('二館', 50) });
  const r = call('replace', { sheet: '交易明細', match: { 月份: '2099-10', 門店: '本館' }, rows: rows('本館', 999) });
  assert.equal(r.data.removed, 1);
  const all = call('read', { sheets: ['交易明細'] }).data['交易明細'];
  assert.deepEqual(all.map((x) => x['金額']).sort(), ['50', '999']);
});

test('upsert 只更新給定欄位；batch 會寫操作紀錄', () => {
  const { call } = load();
  call('init', {});
  call('upsert', { sheet: '月業績', keys: ['月份', '養護師'], rows: [{ 月份: '2099-10', 養護師: '甲甲', 業績: 1, 確認狀態: '未確認' }] });
  const r = call('batch', {
    ops: [{ action: 'upsert', payload: { sheet: '月業績', keys: ['月份', '養護師'], rows: [{ 月份: '2099-10', 養護師: '甲甲', 確認狀態: '已確認' }] } }],
    log: { 動作: '確認', 內容: '甲甲 2099-10' },
  });
  assert.equal(r.ok, true);
  const d = call('read', { sheets: ['月業績', '操作紀錄'] }).data;
  assert.equal(d['月業績'].length, 1);
  assert.equal(d['月業績'][0]['業績'], '1');
  assert.equal(d['月業績'][0]['確認狀態'], '已確認');
  assert.equal(d['操作紀錄'].at(-1)['動作'], '確認');
});

test('拒絕未知分頁與公式注入', () => {
  const { call, sheets } = load();
  call('init', {});
  assert.equal(call('read', { sheets: ['機密'] }).ok, false);
  call('append', { sheet: '養護師', rows: [{ 姓名: '=IMPORTXML("x")' }] });
  assert.equal(sheets['養護師'].d[1][0], `'=IMPORTXML("x")`);
});
