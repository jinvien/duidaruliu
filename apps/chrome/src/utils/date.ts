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

  // 5. 超过30天，显示年份
  const year = updatedDate.getFullYear();
  return year.toString();
}
