import type { PluginModule } from '../../../../types';

export const manifest: PluginModule['manifest'] = {
  id: 'fixture-good-plugin',
  name: 'Fixture Good Plugin',
  category: 'action',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

export const generators: PluginModule['generators'] = {
  local: () => ({ files: [{ path: 'index.ts', content: '// ok' }], infra: [] }),
};
