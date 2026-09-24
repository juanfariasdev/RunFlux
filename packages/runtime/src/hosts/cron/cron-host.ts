import type { Clock, Logger } from '../../contracts/services.js';
import type { WorkflowRunner } from '../../contracts/runner.js';
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

/**
 * Starts each schedule's trigger when it fires. Failures are logged; they never stop the schedule.
 * Disposing the runner is up to its owner.
 */
export class CronHost {
  private readonly runner: WorkflowRunner;
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly tasks: ScheduledTask[] = [];
  private starting?: Promise<readonly ScheduledTask[]>;

  constructor(runner: WorkflowRunner, options: CronHostOptions = {}) {
    this.runner = runner;
    this.scheduler = options.scheduler ?? new NodeCronScheduler();
    this.logger = options.logger ?? new ConsoleLogger();
    this.clock = options.clock ?? new SystemClock();
  }

  get schedules(): readonly ScheduleTrigger[] {
    return this.runner.workflow.triggers.schedules;
  }

  /**
   * Registers every schedule once; calling it again returns the same tasks. When one schedule
   * cannot be registered, those already registered are stopped and the error is rethrown.
   */
  start(): Promise<readonly ScheduledTask[]> {
    this.starting ??= this.register();
    return this.starting;
  }

  /** Stops every schedule. */
  stop(): void {
    for (const task of this.tasks.splice(0)) task.stop();
    this.starting = undefined;
  }

  /** Runs the schedule's trigger once, as if it had fired now. */
  async fire(schedule: ScheduleTrigger): Promise<void> {
    const payload: ScheduledRun = {
      triggeredAt: this.clock.now().toISOString(),
      cronExpression: schedule.expression,
      timezone: schedule.timezone,
    };
    try {
      const execution = await this.runner.run({ payload, triggerId: schedule.nodeId });
      if (!execution.succeeded) this.logger.error('[RunFlux Cron]', execution.error);
    } catch (error) {
      this.logger.error('[RunFlux Cron]', error);
    }
  }

  private async register(): Promise<readonly ScheduledTask[]> {
    try {
      for (const schedule of this.schedules) {
        this.tasks.push(await this.scheduler.schedule(schedule.expression, schedule.timezone, () => this.fire(schedule)));
      }
      return [...this.tasks];
    } catch (error) {
      this.stop();
      throw error;
    }
  }
}
