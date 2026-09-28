import 'dotenv/config';
import { loadConfig, type ServerConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import { ConfigurationError } from './errors.js';
import { createServer } from './server.js';

let config: ServerConfig;
let container: Container;
try {
  config = loadConfig();
  container = createContainer(config);
} catch (error) {
  // A setting the server must not start with, such as an exposed HOST without a token (RN-02).
  if (!(error instanceof ConfigurationError)) throw error;
  console.error(`[project-server] ${error.message}`);
  process.exit(1);
}

const migrated = await container.migration.run();
if (migrated.sealed > 0) console.log(`[project-server] sealed ${migrated.sealed} value(s) in ${migrated.projects} project(s)`);

createServer(container, config).listen(config.port, config.host, () => {
  console.log(`[project-server] listening on http://${config.host}:${config.port} (authentication ${config.apiToken ? 'on' : 'off'})`);
});
