import { describe, expect, it } from 'vitest';
import { CronExpression, CronExpressionError, isTimeZone } from '../cron-expression.js';

describe('CronExpression.parse', () => {
  it.each([
    '* * * * *',
    '*/15 * * * *',
    '0 9 * * 1-5',
    '0 0 1,15 * *',
    '30 23 31 12 7',
    '0 0 * JAN-MAR MON-FRI',
    '0 0 * * sun',
    '5-45/10 0-23/2 */3 */2 */7',
  ])('accepts %s', (expression) => {
    expect(CronExpression.parse(expression).text).toBe(expression);
  });

  it('normalizes surrounding and repeated whitespace', () => {
    expect(CronExpression.parse('  0   9 * *  1-5 ').toString()).toBe('0 9 * * 1-5');
  });

  it('exposes each field with its items', () => {
    const expression = CronExpression.parse('*/15 9-17 * JAN,JUL MON-FRI');
    expect(expression.field('minute')).toEqual({ name: 'minute', text: '*/15', any: false, items: [{ text: '*/15', step: 15 }] });
    expect(expression.field('hour').items).toEqual([{ text: '9-17', range: { start: 9, end: 17 }, step: undefined }]);
    expect(expression.field('dayOfMonth').any).toBe(true);
    expect(expression.field('month').items.map((item) => item.range)).toEqual([{ start: 1, end: 1 }, { start: 7, end: 7 }]);
    expect(expression.field('dayOfWeek').items[0].range).toEqual({ start: 1, end: 5 });
  });

  it.each([
    ['', 'expected 5 fields (minute hour day-of-month month day-of-week), got 0'],
    ['* * * *', 'expected 5 fields (minute hour day-of-month month day-of-week), got 4'],
    ['0 * * * * *', 'expected 5 fields (minute hour day-of-month month day-of-week), got 6'],
    ['60 * * * *', 'minute "60" is not a value from 0 to 59'],
    ['* 24 * * *', 'hour "24" is not a value from 0 to 23'],
    ['* * 0 * *', 'day of month "0" is not a value from 1 to 31'],
    ['* * * 13 *', 'month "13" is not a value from 1 to 12'],
    ['* * * * 8', 'day of week "8" is not a value from 0 to 7'],
    ['* * * FOO *', 'month "FOO" is not a value from 1 to 12'],
    ['*/0 * * * *', 'minute "*/0" needs a positive whole step'],
    ['*/x * * * *', 'minute "*/x" needs a positive whole step'],
    ['5-1 * * * *', 'minute "5-1" is a range that ends before it starts'],
    ['1-2-3 * * * *', 'minute "1-2-3" is malformed'],
    ['*/2/3 * * * *', 'minute "*/2/3" is malformed'],
    ['1,,2 * * * *', 'minute "" is malformed'],
    ['-5 * * * *', 'minute "-5" is not a value from 0 to 59'],
    ['? * * * *', 'minute "?" is not a value from 0 to 59'],
  ])('rejects %j: %s', (expression, problem) => {
    expect(() => CronExpression.parse(expression)).toThrow(new CronExpressionError(expression, problem));
    expect(CronExpression.isValid(expression)).toBe(false);
  });
});

describe('isTimeZone', () => {
  it.each(['UTC', 'America/Sao_Paulo', 'Europe/Lisbon', 'Asia/Tokyo'])('accepts %s', (zone) => {
    expect(isTimeZone(zone)).toBe(true);
  });

  it.each(['', ' ', 'Mars/Olympus', 'GMT+25', 'not a zone'])('rejects %j', (zone) => {
    expect(isTimeZone(zone)).toBe(false);
  });
});
