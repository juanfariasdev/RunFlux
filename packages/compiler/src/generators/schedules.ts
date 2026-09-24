import type { WorkflowDefinition } from '@runflux/workflow-model';

export function getSchedules(workflow: WorkflowDefinition) {
  return workflow.nodes.filter((node) => node.pluginId === 'trigger-cron').map((node) => ({
    nodeId: node.id,
    expression: String(node.parameters.expression || '*/15 * * * *'),
    timezone: String(node.parameters.timezone || 'UTC'),
  }));
}

/** AWS uses six fields, 1-based weekdays, and mutually exclusive day selectors. */
export function toAwsCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('AWS cron requires a five-field Unix expression (seconds are unsupported)');
  const [minute, hour, day, month, weekday] = fields;
  if (day !== '*' && weekday !== '*') throw new Error('AWS cron cannot combine day-of-month and day-of-week constraints');
  if (/\d/.test(weekday) && weekday.split(/[,/\-]/).some((part) => part === '7')) throw new Error('Use SUN or 0 instead of 7 for Sunday when compiling to AWS');
  const awsWeekday = weekday === '*' ? '?' : weekday.split(',').map((part) => {
    const [range, step] = part.split('/');
    const mapped = range.replace(/\d+/g, (value) => String(Number(value) + 1));
    return step ? `${mapped}/${step}` : mapped;
  }).join(',');
  return `cron(${minute} ${hour} ${weekday === '*' ? day : '?'} ${month} ${awsWeekday} *)`;
}
