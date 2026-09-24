import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorClient, ExpressClient, LambdaClient, ServerProcessClient, type BackendClient } from '../support/backend-clients';
import { buildExample, loadExample, nodeIds, workflowOf, type ExampleProject } from '../support/examples';
import type { ExportedProject } from '../support/exported-project';
import { scenariosFor, verify, type Scenario } from '../support/scenarios';
import { editorRegistry } from '../support/workflows';

const QUEUES = ['queue-urgent', 'billing-manager', 'billing-automatic', 'queue-partner', 'queue-bugs', 'queue-low', 'queue-general'];
/** Each triage node and the action it answers. */
const ACTIONS: Record<string, string> = {
  'needs-assignee': 'assign', 'security-review': 'security-review', 'request-logs': 'request-logs', prioritize: 'prioritize', backlog: 'backlog',
};

/** A ticket routed to `queue`: the route's node ran, and no other route did. */
function routed(name: string, body: Record<string, unknown>, queue: string, result: Record<string, unknown>): Scenario {
  return {
    name,
    request: { method: 'POST', path: '/tickets', body },
    respondedBy: 'ticket-routed',
    result,
    ran: ['route-ticket', queue],
    skipped: QUEUES.filter((other) => other !== queue),
  };
}

function triaged(name: string, body: Record<string, unknown>, action: string | null): Scenario {
  return {
    name,
    request: { method: 'POST', path: '/tickets/triage', body },
    ...(action ? { respondedBy: action, result: { action: ACTIONS[action] } } : {}),
    ran: ['triage'],
    skipped: Object.keys(ACTIONS).filter((other) => other !== action),
  };
}

const SCENARIOS: Scenario[] = [
  // Rule 1: "or" of two conditions
  routed('rule 1 takes an urgent ticket', { priority: 'urgent', subject: 'Site down' }, 'queue-urgent', { queue: 'urgent', sla: '1h', subject: 'Site down' }),
  routed('rule 1 takes a VIP customer through its second condition', { customer: { tier: 'vip' }, subject: 'Question' }, 'queue-urgent', { queue: 'urgent' }),
  // Rule 2: "and", with a nested If
  routed('rule 2 sends a small refund to automatic billing', { subject: 'Refund request', amount: 50 }, 'billing-automatic', { queue: 'billing', approval: 'automatic' }),
  routed('rule 2 sends a large refund to manager approval', { subject: 'REFUND now', amount: 5000 }, 'billing-manager', { queue: 'billing', approval: 'manager', subject: 'REFUND now' }),
  routed('rule 2 needs both conditions: a refund of zero falls through to the fallback', { subject: 'Refund', amount: 0 }, 'queue-general', { queue: 'general' }),
  // Rules 3 to 5: string, array and numeric operators
  routed('rule 3 matches the partner domain with endsWith', { email: 'ana@partner.com', subject: 'Hi' }, 'queue-partner', { queue: 'partners', sla: '4h' }),
  routed('rule 3 ignores other domains', { email: 'ana@partner.com.evil.io', subject: 'Hi' }, 'queue-general', { queue: 'general' }),
  routed('rule 4 finds a tag in a list with contains', { tags: ['ui', 'bug'], subject: 'Button' }, 'queue-bugs', { queue: 'engineering', sla: '1d' }),
  routed('rule 5 compares a numeric score', { score: 2, subject: 'meh' }, 'queue-low', { queue: 'low-priority', sla: '3d' }),
  routed('rule 5 compares a score sent as text, including the boundary', { score: '3', subject: 'fine' }, 'queue-low', { queue: 'low-priority' }),
  routed('rule 5 lets a higher score fall through', { score: 4, subject: 'good' }, 'queue-general', { queue: 'general' }),
  // Fallback and precedence
  routed('the fallback takes a ticket no rule matches', { subject: 'Hello' }, 'queue-general', { queue: 'general', sla: '2d', subject: 'Hello' }),
  routed('the fallback takes an empty ticket', {}, 'queue-general', { queue: 'general', subject: '(no subject)' }),
  routed('the first matching rule wins when several match', { priority: 'urgent', subject: 'refund', amount: 10, tags: ['bug'], score: 1 }, 'queue-urgent', { queue: 'urgent' }),
  routed('rule 2 wins over rules 3 to 5', { subject: 'refund', amount: 10, email: 'a@partner.com', tags: ['bug'], score: 1 }, 'billing-automatic', { queue: 'billing' }),
  // Triage: a switch without fallback
  triaged('triage rule 1: an open ticket without assignee (notEquals and isEmpty)', { status: 'open', title: 'Login fails' }, 'needs-assignee'),
  triaged('triage rule 2: a security title (startsWith)', { status: 'closed', title: '[SEC] Token leak' }, 'security-review'),
  triaged('triage rule 3: a crash in the body (regex)', { status: 'closed', title: 'App', body: 'Crash on start: exception thrown' }, 'request-logs'),
  triaged('triage rule 4: a popular ticket (greaterThanOrEqual)', { status: 'closed', title: 'Dark mode', votes: 10 }, 'prioritize'),
  triaged('triage rule 5: an open, assigned ticket without wontfix (equals and notContains)', { status: 'open', assignee: 'bob', title: 'Polish', labels: ['ux'] }, 'backlog'),
  triaged('triage ends the branch when no rule matches, without an error', { status: 'open', assignee: 'bob', title: 'Won\'t do', labels: ['wontfix'] }, null),
  // HTTP semantics
  { name: 'triage accepts only POST', request: { method: 'GET', path: '/tickets/triage' }, status: 405 },
  { name: 'an invalid ticket body gets 400', request: { method: 'POST', path: '/tickets', headers: { 'Content-Type': 'application/json' }, text: '[1,' }, status: 400 },
];

const HOSTS = ['editor', 'express', 'process', 'lambda'] as const;
type Host = (typeof HOSTS)[number];
const TITLES: Record<Host, string> = { editor: 'editor test run', express: 'exported Express app', process: 'exported server process', lambda: 'exported Lambda handler' };
const HTTP: Record<Host, boolean> = { editor: false, express: true, process: true, lambda: true };

let example: ExampleProject;
let local: ExportedProject;
const projects: ExportedProject[] = [];
const clients = new Map<Host, BackendClient>();
/** Nodes the schedule tests ran, with engines of their own clock. */
const scheduled = new Set<string>();

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  example = await loadExample('switch-routing');
  let aws: ExportedProject;
  [local, aws] = await Promise.all([buildExample(example, 'local'), buildExample(example, 'aws')]);
  projects.push(local, aws);
  clients.set('editor', new EditorClient(workflowOf(example), await editorRegistry()));
  clients.set('express', await ExpressClient.create(local));
  clients.set('process', await ServerProcessClient.start(local, {}));
  clients.set('lambda', await LambdaClient.create(aws));
}, 120_000);

afterAll(async () => {
  for (const client of clients.values()) await client.close();
  await Promise.all(projects.map((project) => project.dispose()));
  vi.restoreAllMocks();
});

describe.each(HOSTS.map((host) => [TITLES[host], host] as const))('Switch example through the %s', (_title, host) => {
  it.each(scenariosFor(HTTP[host], SCENARIOS))('%s', async (_name, scenario) => {
    await verify(clients.get(host)!, scenario);
  });
});

describe('Switch example schedule', () => {
  /** The digest the schedule's switch must pick for a firing time. */
  const expectedDigest = (at: string) => (new Date(at).getUTCHours() < 12 ? 'morning-digest' : 'evening-digest');

  it('routes the digest by the hour of each firing through the exported cron host', async () => {
    const { CronHost } = await local.runtime('cron');
    for (const hour of [3, 15]) {
      // The trigger stamps the firing time with the engine's clock, so both get the same one.
      const clock = { now: () => new Date(Date.UTC(2026, 0, 1, hour)) };
      const engine = await local.engine({ services: { clock, logger: { info() {}, error() {} } } });
      const run = vi.spyOn(engine, 'run');
      const tasks: Array<() => Promise<void>> = [];
      await new CronHost(engine, { clock, scheduler: { schedule: (_expression: string, _timezone: string, task: () => Promise<void>) => { tasks.push(task); return { stop() {} }; } } }).start();
      await tasks[0]();
      const execution = await run.mock.results[0].value;
      const digest = hour < 12 ? 'morning-digest' : 'evening-digest';
      expect(execution.toResponse()).toMatchObject({ success: true, result: { digest: digest.replace('-digest', ''), at: `2026-01-01T${String(hour).padStart(2, '0')}:00:00.000Z` } });
      expect(execution.records.map((record: { nodeId: string }) => record.nodeId)).toEqual(['digest-schedule', 'digest-window', digest]);
      for (const record of execution.records) scheduled.add(record.nodeId);
    }
  });

  it('routes the digest when EventBridge invokes the Lambda handler', async () => {
    const { status, body } = await (clients.get('lambda') as LambdaClient).schedule('digest-schedule');
    expect(status).toBe(200);
    expect(body.nodeOutputs).toHaveProperty([expectedDigest(body.result.at)]);
  });

  it('reached every node of the workflow in the exported backend', () => {
    const express = clients.get('express') as ExpressClient;
    expect(nodeIds(example).filter((id) => !express.executed.has(id) && !scheduled.has(id))).toEqual([]);
  });
});
