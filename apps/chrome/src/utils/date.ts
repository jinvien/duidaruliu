/**
 * 获取时间组
 * @param timestamp
 * @returns
 */

export function getTimeGroup(timestamp: number): string {
  const now = new Date();
  const updatedDate = new Date(timestamp);
  const diffInTime = now.getTime() - updatedDate.getTime();
  const diffInDays = Math.floor(diffInTime / (1000 * 3600 * 24)); // Convert time difference to days

  // 1. 今天
  if (diffInDays < 1) {
    return 'today';
  }

  // 2. 昨天
  if (diffInDays === 1) {
    return 'lastDay';
  }

  // 3. 最近7天
  if (diffInDays <= 7) {
    return 'last7Day';
  }

  // 4. 过去30天
  if (diffInDays <= 30) {
    return 'last30Day';
  }

  // 5. 超过30天，归入「更早」
  return 'earlier';
}

export type HistoryListTime =
  | { type: 'justNow' }
  | { type: 'minutes'; count: number }
  | { type: 'hours'; count: number }
  | { type: 'yesterday'; time: string }
  | { type: 'days'; count: number }
  | { type: 'monthDay'; text: string }
  | { type: 'full'; text: string };

/**
 * 历史列表第二行的时间。调用方传入打开面板时的 openedAt，这里不读当前时钟，也不负责刷新。
 *
 * 分界按本地日历，不用「满 24 小时」的滚动窗口：
 * 过了零点即使只过了几分钟，也不再算同一天。
 * - 同一本地日历日：不足 1 分钟为刚刚，否则向下取整为 N 分钟前 / N 小时前，不显示时钟时分。
 * - 本地日历的前一天：昨天 + HH:mm。
 * - 早于昨天，且会话日不早于「打开日减去 1 个日历月」：N 天前。
 *   月末用该月最后一天截断，例如 3 月 31 日减去 1 个月是 2 月 28/29 日。
 *   会话日早于这条边界，才算超过一个月。
 * - 已超过一个日历月，且会话日不早于「打开日减去 1 个日历年」：MM-DD HH:mm。
 * - 会话日早于「打开日减去 1 个日历年」：YYYY-MM-DD HH:mm。
 */
export function classifyHistoryListTime(
  timestamp: number,
  openedAt: number
): HistoryListTime | null {
  const opened = new Date(openedAt);
  const target = new Date(timestamp);
  if (Number.isNaN(opened.getTime()) || Number.isNaN(target.getTime())) return null;

  const openDay = startOfLocalDay(opened);
  const targetDay = startOfLocalDay(target);
  const dayGap = calendarDayGap(openDay, targetDay);

  if (dayGap <= 0) {
    const elapsedMs = openedAt - timestamp;
    if (elapsedMs < 60_000) return { type: 'justNow' };
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 60) return { type: 'minutes', count: minutes };
    return { type: 'hours', count: Math.floor(elapsedMs / 3_600_000) };
  }

  if (dayGap === 1) {
    return { type: 'yesterday', time: formatClock(target) };
  }

  const oneMonthAgo = addCalendarMonths(openDay, -1);
  if (targetDay.getTime() >= oneMonthAgo.getTime()) {
    return { type: 'days', count: dayGap };
  }

  if (targetDay.getTime() >= addCalendarMonths(openDay, -12).getTime()) {
    return { type: 'monthDay', text: `${formatMonthDay(target)} ${formatClock(target)}` };
  }

  return {
    type: 'full',
    text: `${target.getFullYear()}-${formatMonthDay(target)} ${formatClock(target)}`,
  };
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function calendarDayGap(openDay: Date, targetDay: Date): number {
  return Math.round((openDay.getTime() - targetDay.getTime()) / 86_400_000);
}

function addCalendarMonths(day: Date, months: number): Date {
  const cursor = new Date(day.getFullYear(), day.getMonth() + months, 1);
  const lastDate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  cursor.setDate(Math.min(day.getDate(), lastDate));
  return cursor;
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}

function formatMonthDay(date: Date): string {
  return `${padTime(date.getMonth() + 1)}-${padTime(date.getDate())}`;
}

function formatClock(date: Date): string {
  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}
