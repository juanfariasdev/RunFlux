import { defineNode, NodeOutput } from '@runflux/runtime';

export default defineNode({
  parseParameters: () => ({}),
  createHandler: () => ({ execute: ({ input }) => NodeOutput.main({ received: input }) }),
});
