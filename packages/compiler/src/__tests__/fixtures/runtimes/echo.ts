import { defineNode, NodeOutput } from '@runflux/runtime';

/** Emits its `prefix` parameter joined with its input. */
export default defineNode({
  parseParameters: (parameters) => ({ prefix: parameters.string('prefix', '') }),
  createHandler: () => ({ execute: ({ parameters, input }) => NodeOutput.main(`${parameters.prefix}${JSON.stringify(input)}`) }),
});
