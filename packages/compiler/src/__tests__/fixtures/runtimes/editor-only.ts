import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { defineNode, NodeOutput } from '@runflux/runtime';

// Invalid on purpose: backend code must not depend on editor packages.
export default defineNode({
  parseParameters: () => ({}),
  createHandler: () => ({ execute: () => NodeOutput.main(validateManifest({})) }),
});
