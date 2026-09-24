export const manifest = {
  id: 'fixture-scoped-plugin',
  name: 'Fixture Scoped Plugin',
  category: 'output',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

export const runtimeModule = new URL('./runtime.js', import.meta.url);
