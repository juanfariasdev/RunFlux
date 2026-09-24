import { LambdaHost } from '@runflux/runtime/lambda';
import { engine } from './workflow.js';

/** Lambda entry point: function URL requests and EventBridge schedules. */
export const handler = new LambdaHost(engine).handler;
