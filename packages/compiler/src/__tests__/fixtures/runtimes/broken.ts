import { defineNode, NodeOutput } from '@runflux/runtime';
// @ts-expect-error Missing on purpose: the bundler must report it.
import { missing } from './missing-module.js';

export default defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => NodeOutput.main(missing) }) });
