/**
 * Translates a five-field Unix cron expression into an EventBridge Scheduler expression, which has
 * six fields, numbers weekdays from 1 (Sunday) and requires `?` in one of the day fields. Rejects
 * what EventBridge cannot express instead of changing the schedule.
 */
export function toAwsCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('AWS cron requires a five-field Unix expression (seconds are unsupported)');
  const [minute, hour, day, month, weekday] = fields;
  if (day !== '*' && weekday !== '*') throw new Error('AWS cron cannot combine day-of-month and day-of-week constraints');
  if (/\d/.test(weekday) && weekday.split(/[,/-]/).some((part) => part === '7')) {
    throw new Error('Use SUN or 0 instead of 7 for Sunday when compiling to AWS');
  }
  const awsWeekday = weekday === '*' ? '?' : weekday.split(',').map((part) => {
    const [range, step] = part.split('/');
    const shifted = range.replace(/\d+/g, (value) => String(Number(value) + 1));
    return step ? `${shifted}/${step}` : shifted;
  }).join(',');
  return `cron(${minute} ${hour} ${weekday === '*' ? day : '?'} ${month} ${awsWeekday} *)`;
}
