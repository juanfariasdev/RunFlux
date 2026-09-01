/** Default discovery logger — pass as `onLog` to PluginRegistry.discover() (RF-01 observability). */
export function consoleDiscoveryLogger(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[runflux:discovery] ${message}`);
}
