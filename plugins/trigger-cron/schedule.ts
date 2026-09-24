import { CronExpression, CronExpressionError, isTimeZone, type ParameterReader } from '@runflux/runtime';

export interface CronSchedule {
  /** Five-field Unix cron expression, validated. */
  readonly expression: string;
  /** IANA timezone the expression is read in. */
  readonly timezone: string;
}

export const DEFAULT_SCHEDULE: CronSchedule = { expression: '*/15 * * * *', timezone: 'UTC' };

/** Common schedules the editor suggests for the expression. */
export const SCHEDULE_PRESETS = [
  { value: '*/5 * * * *', label: 'Every 5 minutes' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 0 * * *', label: 'Every day at midnight' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9:00' },
];

export function readCronSchedule(parameters: ParameterReader): CronSchedule {
  const expression = parameters.string('expression', DEFAULT_SCHEDULE.expression);
  const timezone = parameters.string('timezone', DEFAULT_SCHEDULE.timezone);
  let parsed: CronExpression;
  try {
    parsed = CronExpression.parse(expression);
  } catch (error) {
    if (error instanceof CronExpressionError) throw parameters.error('expression', `is not a valid cron expression: ${error.problem}`);
    throw error;
  }
  if (!isTimeZone(timezone)) throw parameters.error('timezone', `"${timezone}" is not a known IANA timezone`);
  return { expression: parsed.text, timezone };
}
