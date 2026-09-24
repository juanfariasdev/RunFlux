import { CronExpression, type CronField } from '@runflux/runtime';

const LAST_WEEKDAY = 6;

/**
 * Translates a five-field Unix cron expression into an EventBridge Scheduler expression, which has
 * six fields, needs `?` in one of the day fields, numbers weekdays from 1 (Sunday) and accepts no
 * steps in the weekday field; weekdays are therefore written as the list of days they select.
 * Rejects what EventBridge cannot express instead of changing the schedule.
 */
export function toAwsCron(expression: string): string {
  const [minute, hour, day, month, weekday] = CronExpression.parse(expression).fields;
  if (!day.any && !weekday.any) throw new Error('AWS cron cannot combine day-of-month and day-of-week constraints');
  return `cron(${minute.text} ${hour.text} ${weekday.any ? day.text : '?'} ${month.text} ${weekday.any ? '?' : awsWeekdays(weekday)} *)`;
}

/** The Unix weekdays (0-6, Sunday first) a field selects, as EventBridge days (1-7) in ranges. */
function awsWeekdays(field: CronField): string {
  const days = new Set<number>();
  for (const item of field.items) {
    const start = item.range?.start ?? 0;
    // `a/n` steps from a to the last weekday, like `a-6/n`.
    const end = !item.range || (item.step && item.range.start === item.range.end) ? LAST_WEEKDAY : item.range.end;
    for (let value = start; value <= end; value += item.step ?? 1) days.add(value % 7);
  }
  return runs([...days].sort((a, b) => a - b))
    .map(([first, last]) => (first === last ? `${first + 1}` : `${first + 1}-${last + 1}`))
    .join(',');
}

function runs(values: readonly number[]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const value of values) {
    const last = result.at(-1);
    if (last && value === last[1] + 1) last[1] = value;
    else result.push([value, value]);
  }
  return result;
}
