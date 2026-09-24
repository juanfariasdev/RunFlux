export default {
  parseParameters: () => ({}),
  createHandler: () => ({ execute: ({ input }) => ({ value: input, activeOutput: 'main' }) }),
};
