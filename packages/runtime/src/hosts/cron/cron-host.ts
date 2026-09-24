import type { Clock, Logger } from '../../contracts/services.js';
import type { WorkflowEngine } from '../../engine/workflow-engine.js';
import { ConsoleLogger, SystemClock } from '../../services/default-services.js';
import type { ScheduleTrigger } from '../../workflow/triggers.js';

export interface ScheduledTask {
  stop(): void;
}

/** Calls `task` on every tick of a cron expression. */
export interface Scheduler {
  schedule(expression: string, timezone: string, task: () => Promise<void>): ScheduledTask | Promise<ScheduledTask>;
}

/** Scheduler backed by node-cron, which is loaded only when a schedule is registered. */
export class NodeCronScheduler implements Scheduler {
  async schedule(expression: string, timezone: string, task: () => Promise<void>): Promise<ScheduledTask> {
    const { schedule } = await import('node-cron');
    return schedule(expression, task, { timezone });
  }
}

/** The payload a cron trigger receives when its schedule fires. */
export interface ScheduledRun {
  readonly triggeredAt: string;
  readonly cronExpression: string;
  readonly timezone: string;
}

export interface CronHostOptions {
  readonly scheduler?: Scheduler;
  readonly logger?: Logger;
  readonly clock?: Clock;
}

/** Starts each schedule's trigger when it fires. Failures are logged; they never stop the schedule. */
export class CronHost {
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private tasks: ScheduledTask[] = [];

  constructor(
    private readonly engine: WorkflowEngine,
    options: CronHostOptions = {},
  ) {
    this.scheduler = options.scheduler ?? new NodeCronScheduler();
    this.logger = options.logger ?? new ConsoleLogger();
    this.clock = options.clock ?? new SystemClock();
  }

  get schedules(): readonly ScheduleTrigger[] {
    return this.engine.workflow.triggers.schedules;
  }

  async start(): Promise<readonly ScheduledTask[]> {
    const started = await Promise.all(
      this.schedules.map((schedule) => this.scheduler.schedule(schedule.expression, schedule.timezone, () => this.fire(schedule))),
    );
    this.tasks.push(...started);
    return started;
  }

  /** Stops every schedule and releases the engine's resources. */
  async stop(): Promise<void> {
    for (const task of this.tasks.splice(0)) task.stop();
    await this.engine.dispose();
  }

  /** Runs the schedule's trigger once, as if it had fired now. */
  async fire(schedule: ScheduleTrigger): Promise<void> {
    const payload: ScheduledRun = {
      triggeredAt: this.clock.now().toISOString(),
      cronExpression: schedule.expression,
      timezone: schedule.timezone,
    };
    try {
      const execution = await this.engine.run({ payload, triggerId: schedule.nodeId });
      if (!execution.succeeded) this.logger.error('[RunFlux Cron]', execution.error);
    } catch (error) {
      this.logger.error('[RunFlux Cron]', error);
    }
  }
}
