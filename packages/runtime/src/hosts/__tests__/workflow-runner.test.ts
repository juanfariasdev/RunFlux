import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { RunRequest, WorkflowRunner } from '../../contracts/runner.js';
import { CliHost } from '../cli/cli-host.js';
import { CronHost } from '../cron/cron-host.js';
import { ExpressHost } from '../express/express-host.js';
import { LambdaHost } from '../lambda/lambda-host.js';
import { hostEngine, httpTrigger } from './fixtures.js';

/** Wraps a runner and records every request, as a composition root may wrap the engine. */
function recording(inner: WorkflowRunner): { runner: WorkflowRunner; requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  const runner: WorkflowRunner = {
    workflow: inner.workflow,
    run: (runRequest) => {
      requests.push(runRequest);
      return inner.run(runRequest);
    },
  };
  return { runner, requests };
}

describe('hosts serve any WorkflowRunner', () => {
  const schedule = { nodeId: 'nightly', expression: '0 0 * * *', timezone: 'UTC' };
  const engine = () => hostEngine({ http: [httpTrigger('orders')], schedules: [schedule] });

  it('ExpressHost runs requests through the runner it is given', async () => {
    const { runner, requests } = recording(engine());
    const response = await request(new ExpressHost(runner).app).post('/orders').send({ id: 1 });
    expect(response.status).toBe(200);
    expect(requests.map((runRequest) => runRequest.triggerId)).toEqual(['orders']);
  });

  it('LambdaHost runs events through the runner it is given', async () => {
    const { runner, requests } = recording(engine());
    const response = await new LambdaHost(runner).handler({ rawPath: '/orders', requestContext: { http: { method: 'POST' } }, body: '{}' });
    expect(response.statusCode).toBe(200);
    expect(requests.map((runRequest) => runRequest.triggerId)).toEqual(['orders']);
  });

  it('CronHost and CliHost run through the runner they are given', async () => {
    const { runner, requests } = recording(engine());
    await new CronHost(runner).fire(schedule);
    expect(await new CliHost(runner, { log: () => {}, error: () => {} }).run(['{"a":1}'])).toBe(0);
    expect(requests.map((runRequest) => runRequest.triggerId)).toEqual(['nightly', undefined]);
  });
});
