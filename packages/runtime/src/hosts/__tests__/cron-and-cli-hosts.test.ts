import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CliHost } from '../cli/cli-host.js';
import { CronHost, type Scheduler } from '../cron/cron-host.js';
import { hostEngine } from './fixtures.js';

const clock = { now: () => new Date('2026-01-01T12:00:00.000Z') };
const schedules = [
  { nodeId: 'first', expression: '*/15 * * * *', timezone: 'UTC' },
  { nodeId: 'second', expression: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' },
];

function fakeScheduler() {
  const registered: Array<{ expression: string; timezone: string; task: () => Promise<void>; stop: ReturnType<typeof vi.fn> }> = [];
  const scheduler: Scheduler = {
    schedule: (expression, timezone, task) => {
      const entry = { expression, timezone, task, stop: vi.fn() };
      registered.push(entry);
      return entry;
    },
  };
  return { registered, scheduler };
}

describe('CronHost', () => {
  it('registers every schedule and starts its own trigger with the schedule payload', async () => {
    const engine = hostEngine({ schedules });
    const run = vi.spyOn(engine, 'run');
    const { registered, scheduler } = fakeScheduler();
    await new CronHost(engine, { scheduler, clock }).start();
    expect(registered.map(({ expression, timezone }) => [expression, timezone])).toEqual([['*/15 * * * *', 'UTC'], ['0 9 * * 1-5', 'America/Sao_Paulo']]);
    for (const { task } of registered) await task();
    expect(run.mock.calls.map(([request]) => request)).toEqual([
      { triggerId: 'first', payload: { triggeredAt: '2026-01-01T12:00:00.000Z', cronExpression: '*/15 * * * *', timezone: 'UTC' } },
      { triggerId: 'second', payload: { triggeredAt: '2026-01-01T12:00:00.000Z', cronExpression: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' } },
    ]);
  });

  it('logs failed runs and thrown errors without stopping', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const failing = new CronHost(hostEngine({ schedules, failing: ['first'] }), { scheduler: fakeScheduler().scheduler, logger, clock });
    await failing.fire(schedules[0]);
    expect(logger.error).toHaveBeenCalledWith('[RunFlux Cron]', 'node failed');
    const engine = hostEngine({ schedules });
    vi.spyOn(engine, 'run').mockRejectedValue(new Error('crashed'));
    await new CronHost(engine, { logger, clock }).fire(schedules[1]);
    expect(logger.error).toHaveBeenLastCalledWith('[RunFlux Cron]', new Error('crashed'));
  });

  it('registers once, stops every task and leaves the engine to its owner', async () => {
    const engine = hostEngine({ schedules });
    const dispose = vi.spyOn(engine, 'dispose');
    const { registered, scheduler } = fakeScheduler();
    const host = new CronHost(engine, { scheduler });
    const [first, second] = await Promise.all([host.start(), host.start()]);
    expect(first).toBe(second);
    expect(registered).toHaveLength(2);
    host.stop();
    expect(registered.every(({ stop }) => stop.mock.calls.length === 1)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('stops the schedules already registered when one cannot be', async () => {
    const stop = vi.fn();
    const scheduler: Scheduler = {
      schedule: (expression) => {
        if (expression === '0 9 * * 1-5') throw new Error('invalid timezone');
        return { stop };
      },
    };
    await expect(new CronHost(hostEngine({ schedules }), { scheduler }).start()).rejects.toThrow('invalid timezone');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not load node-cron for a workflow without schedules', async () => {
    expect(await new CronHost(hostEngine()).start()).toEqual([]);
  });
});

describe('CliHost', () => {
  const output = () => ({ log: vi.fn(), error: vi.fn() });

  it.each([
    [['{"id":42}'], { id: 42 }],
    [['not json'], { raw: 'not json' }],
    [[], {}],
  ])('runs the workflow with %j as payload', async (args, payload) => {
    const io = output();
    expect(await new CliHost(hostEngine(), io).run(args)).toBe(0);
    expect(JSON.parse(io.log.mock.calls[1][0])).toEqual({ success: true, result: payload, nodeOutputs: { manual: payload } });
  });

  it('leaves the engine open for its owner', async () => {
    const engine = hostEngine();
    const dispose = vi.spyOn(engine, 'dispose');
    await new CliHost(engine, output()).run([]);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('exits with 1 when the workflow fails or throws', async () => {
    expect(await new CliHost(hostEngine({ failing: ['manual'] }), output()).run([])).toBe(1);
    const engine = hostEngine();
    vi.spyOn(engine, 'run').mockRejectedValue(new Error('crashed'));
    const io = output();
    expect(await new CliHost(engine, io).run([])).toBe(1);
    expect(io.error).toHaveBeenCalledWith('[RunFlux CLI] Execution error:', new Error('crashed'));
  });

  it('knows whether a module is the script Node was started with', () => {
    const script = fileURLToPath(import.meta.url);
    expect(CliHost.isEntrypoint(import.meta.url, script)).toBe(true);
    expect(CliHost.isEntrypoint(import.meta.url, '/elsewhere/run.mjs')).toBe(false);
    expect(CliHost.isEntrypoint(import.meta.url, undefined)).toBe(false);
  });
});
