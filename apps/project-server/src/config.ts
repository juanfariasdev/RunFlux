import path from 'node:path';

/** The project server's settings, read once from the environment when it starts. */
export interface ServerConfig {
  readonly port: number;
  /** Where compiled backends are written; without it, `output-backends` next to the plugins. */
  readonly outputDirectory?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: env.PORT ? parseInt(env.PORT, 10) : 3001,
    ...(env.RUNFLUX_OUTPUT_DIR ? { outputDirectory: path.resolve(env.RUNFLUX_OUTPUT_DIR) } : {}),
  };
}
