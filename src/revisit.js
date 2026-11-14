// 待回訪名單：養護師服務過、超過建議回店天數還沒回來的客人。純函式。
// 系統不存客人姓名與手機，名單只列訂單號碼、日期、項目，養護師用訂單號碼到神美查詢客人。
import { daysBetween } from './metrics.js';

/**
 * index：metrics.buildIndex 的結果；staff：養護師；refDate：基準日（通常是資料最後一天）
 * days：超過幾天算該回訪；maxDays：超過幾天就不列（太久的客人另行處理）
 * 負責人＝客人「最後一次」消費時擔任設計師的人。
 */
export function revisitList(index, staff, refDate, { days = 45, maxDays = 180 } = {}) {
  const out = [];
  for (const [customer, dates] of index.visits) {
    const last = dates.at(-1);
    const since = daysBetween(last, refDate);
    if (since < days || since > maxDays) continue;
    const rows = index.valid.filter((r) => r.customer === customer && r.date === last);
    const designers = new Set(rows.filter((r) => r.role === '設計師').map((r) => r.staff));
    if (!designers.has(staff)) continue;
    const order = rows.find((r) => r.role === '設計師' && r.staff === staff);
    const orderRows = index.valid.filter((r) => r.orderNo === order.orderNo);
    const items = [...new Set(orderRows.filter((r) => r.type !== '其他').map((r) => r.item ? `${r.type}・${r.item}` : r.type))];
    out.push({ orderNo: order.orderNo, date: last, daysSince: since, visits: dates.length, items });
  }
  return out.sort((a, b) => a.daysSince - b.daysSince);
}

/** 複製給養護師的文字（可貼到 LINE）。 */
export function revisitText(staff, list, refDate, days) {
  const head = `【${staff} 待回訪名單】截至 ${refDate}，以下客人已超過 ${days} 天沒有回來，可以主動關心、邀請預約：`;
  const lines = list.map((x, i) => `${i + 1}. 訂單 ${x.orderNo}（${x.date}，${x.daysSince} 天前）${x.items.slice(0, 2).join('、')}`);
  return [head, ...lines, '※ 請用訂單號碼到神美查詢客人資料。'].join('\n');
}
