// Marked as a plugin but missing the required "id" field.
export const manifest = {
  name: 'Malformed Marked Plugin',
  category: 'action',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

export const runtimeModule = new URL('./index.js', import.meta.url);
