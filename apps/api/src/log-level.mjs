export function logLevel(row) {
  const priority = Number(row.PRIORITY ?? 6);
  const message = String(row.MESSAGE ?? '');
  if (priority <= 3) return 'error';
  // Historical monitor summaries contain the word “失败” even on success.
  // Read their numeric result before applying the fallback keyword detection.
  const summary = message.match(/^\[monitor\] .+: 采集 \d+ 个套餐，失败分类 (\d+) 个\s*$/);
  if (summary) return Number(summary[1]) > 0 ? 'error' : priority <= 4 ? 'warn' : 'info';
  if (/error|failed|错误|失败|异常|HTTP [45]\d{2}/i.test(message)) return 'error';
  if (priority <= 4 || /warning|警告/i.test(message)) return 'warn';
  return 'info';
}
