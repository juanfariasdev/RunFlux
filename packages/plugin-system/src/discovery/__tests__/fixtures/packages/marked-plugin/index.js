export const manifest = {
  id: 'fixture-marked-plugin',
  name: 'Fixture Marked Plugin',
  category: 'action',
  version: '2.0.0',
  parameters: [],
  supportedPlatforms: ['aws'],
};

export const runtimeModule = new URL('./runtime.js', import.meta.url);
