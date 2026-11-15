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
  avgTicket: 4200, customers: 30, productSales: 12, addonSales: 15,
  returnRate: { value: 0.55, num: 11, den: 20, smallSample: true, pending: false, baseMonth: '2099-01' },
  mix: { 草本染髮: 90000, 頭皮護理: 30000, 商品: 18000, 加購服務: 2000, 低敏染髮: 10000 },
};
const prev = { avgTicket: 4000, customers: 33, productSales: 9, addonSales: 15, returnRate: { value: 0.6, num: 9, den: 15 } };

test('近 6 個月跨年', () => {
  assert.deepEqual(lastMonths('2099-02', 6), ['2098-09', '2098-10', '2098-11', '2098-12', '2099-01', '2099-02']);
});

test('指標卡：本月數值＋與自己上月比較', () => {
  const by = Object.fromEntries(CARD_DEFS.map((d) => [d.key, buildCard(d, cur, prev)]));
  assert.equal(by.avgTicket.value, '4,200');
  assert.equal(by.avgTicket.diff.text, '多 200 元');
  assert.equal(by.avgTicket.diff.dir, 'up');
  assert.equal(by.customers.diff.text, '少 3 人');
  assert.equal(by.customers.diff.dir, 'down');
  assert.equal(by.productSales.value, '12');
  assert.equal(by.productSales.unit, '元');
  assert.equal(by.productSales.diff.text, '多 3 元');
  assert.equal(by.returnRate.diff.text, '多 2 人次回流'); // 用人次表達
  assert.equal(by.returnRate.diff.dir, 'up');
  assert.equal(by.returnRate.small, true);
  assert.equal(buildCard(CARD_DEFS[2], { returnRate: { value: 0.5 } }, { returnRate: { pending: true } }).diff, null); // 上月資料累積中 → 不比較
  assert.equal(by.addonSales.diff.text, '與上月持平');
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
  assert.equal(s.progress.text, '已達第一門檻 🎉 距第二門檻還差 60,000 元，好可惜！');
  assert.equal(s.estimatedBonus, 4000);
  assert.equal(s.cards.length, 5);
  assert.equal(s.cards.find((c) => c.key === 'returnRate').note, '1 月服務 20 人次，有 11 人次在 60 天內回來');
  assert.equal(s.smallSampleNote, true);
  assert.equal(s.trend.length, 5);
  assert.equal(s.trend[3].sales, 100000);
  assert.equal(s.praise.quotes.length, 3); // 最多 3 則
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, [], { cur, praise: { mentions: 0, quotes: [] } }).praise, null);
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, [], { cur, praise: { mentions: 2, quotes: [] } }).praise, null); // 有點名但沒勾選 → 隱藏
});

test('店內前三名：同分同名次、0% 不排名、第 4 名以後不顯示', () => {
  const r = topRanks([{ name: 'a', value: 0.3 }, { name: 'b', value: 0.3 }, { name: 'c', value: 0.2 }, { name: 'd', value: 0.1 }, { name: 'e', value: 0 }, { name: 'f', value: null }]);
  assert.deepEqual(r, { a: 1, b: 1, c: 3 });
  const s = buildStatement(rows, '甲甲', '2099-03', P, [], { cur, prev, ranks: { productSales: 2 }, compared: true });
  assert.equal(s.cards.find((c) => c.key === 'productSales').rank, 2);
  assert.equal(s.cards.find((c) => c.key === 'addonSales').rank, null);
  assert.equal(s.cards.find((c) => c.key === 'addonSales').ranked, true); // 沒進前三 → 顯示加油
  assert.equal(s.cards.find((c) => c.key === 'avgTicket').ranked, false);
  assert.equal(buildStatement(rows, '甲甲', '2099-03', P, [], { cur, prev }).cards.find((c) => c.key === 'addonSales').ranked, false); // 不納入比較 → 不顯示
});

test('個人新高與 6 個月走勢', async () => {
  const { isPersonalBest } = await import('../src/statement.js');
  assert.equal(isPersonalBest(10, [5, 8, 9]), true);
  assert.equal(isPersonalBest(9, [5, 8, 9]), false);   // 持平不算
  assert.equal(isPersonalBest(10, [null, 8, 9]), false); // 紀錄不足 3 個月
  assert.equal(isPersonalBest(0, [0, 0, 0]), false);
  const hist = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20].map((n) => ({ productSales: n }));
  const s = buildStatement(rows, '甲甲', '2099-03', P, [], { cur: { ...cur, productSales: 20 }, prev, history: hist });
  const c = s.cards.find((x) => x.key === 'productSales');
  assert.equal(c.best, true);
  assert.deepEqual(c.spark, [11, 12, 13, 14, 15, 20]);
  assert.equal('history' in c, false);
});

test('給你的小建議', async () => {
  const { buildTips } = await import('../src/statement.js');
  const below = { level: 0, toNext: 37000 };
  const t1 = buildTips({ me: { avgTicket: 3700, customers: 27, returnRate: { value: 0.2, num: 5 }, productSales: 0.05, addonSales: 0.1 },
    avg: { returnRate: 0.4, productSales: 0.2, addonSales: 0.3 }, progress: below });
  assert.equal(t1.length, 3);
  assert.match(t1[0].text, /下個月每位客人平均多約 1,380 元.*第一門檻/); // 37000 / 27 ≈ 1370.4 → 1,380
  assert.ok(['💪', '💬', '📅'].includes(t1[1].icon)); // 回流率偏少（輪替說法）
  assert.ok(['🌿', '🧴'].includes(t1[2].icon));
  // 接客天數偏少 → 鼓勵多排班（換算天數）
  const tw = buildTips({ me: { customers: 20, sales: 100000, workDays: 10 }, avg: { workDays: 18 }, progress: { level: 0, toNext: 25000 } });
  assert.ok(['📞', '🍂', '🤝'].includes(tw[1].icon));
  assert.ok(!/休假|排班/.test(JSON.stringify(tw)));
  // 表現好：只鼓勵
  const t2 = buildTips({ me: { avgTicket: 4000, returnRate: { value: 0.5, num: 9 }, productSales: 0.3, addonSales: 0.4 },
    prev: { returnRate: { value: 0.4, num: 8 } }, avg: { returnRate: 0.4, productSales: 0.2, addonSales: 0.3 }, progress: { level: 2 } });
  assert.deepEqual(t2.map((x) => x.text), ['各項表現都很穩定，繼續保持！']);
  // 回流人次比上月少 → 提醒
  const t3 = buildTips({ me: { returnRate: { value: 0.5, num: 7 } }, prev: { returnRate: { value: 0.5, num: 9 } }, avg: { returnRate: 0.5 }, progress: { level: 2 } });
  assert.ok(['💪', '💬', '📅'].includes(t3[0].icon));
  // 個人新高 → 先恭喜
  const t4 = buildTips({ me: {}, avg: {}, progress: { level: 2 }, salesBest: true });
  assert.deepEqual(t4.map((x) => x.icon), ['🎉', '🌱']); // 恭喜＋繼續保持
  // 輪替：不同月份同一種情況可能出現不同說法
  const { tipSeed, TIP_POOL } = await import('../src/statement.js');
  const shown = new Set([1, 2, 3].map((m) => buildTips({ me: { returnRate: { value: 0.1, num: 1 } }, avg: { returnRate: 0.5 }, progress: { level: 2 }, seed: tipSeed('甲甲', `2099-0${m}`) })[0].text));
  assert.equal(shown.size, TIP_POOL.returnLow.length);
  // 待回訪人數
  const tr = buildTips({ me: {}, avg: {}, progress: { level: 2 }, revisit: 6 });
  assert.match(tr[0].text, /你有 6 位客人超過 45 天還沒回來/);
  // 建議文字不含數字平均
  assert.ok(!JSON.stringify(t1).includes('0.4'));
});

test('不含比例、級距業績或店內平均', () => {
  const s = buildStatement(rows, '甲甲', '2099-03', P, [], { cur, prev });
  const json = JSON.stringify(s);
  for (const banned of ['tier', 'R1', 'R2', '"0.2"', '0.3,', '第一級', '第二級', '店內平均', 'storeAvg', 'bonusRate']) {
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

test('勾選 3 則留言時全部顯示，建議改為最多 3 則', () => {
  const me = { avgTicket: 3700, customers: 27, returnRate: { value: 0.2, num: 5 }, productSales: 0.05, addonSales: 0.1 };
  const s = buildStatement(rows, '甲甲', '2099-02', P, [], { cur: me, prev: {}, storeAvg: { returnRate: 0.4, productSales: 0.2, addonSales: 0.3 },
    ranks: { productSales: 1 }, revisit: 10, praise: { mentions: 3, quotes: ['a', 'b', 'c'] } });
  assert.equal(s.praise.quotes.length, 3);
  assert.ok(s.tips.length <= 3);
});
