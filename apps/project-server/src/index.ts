import 'dotenv/config';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createServer } from './server.js';

const config = loadConfig();
const app = createServer(createContainer(config));

app.listen(config.port, () => {
  console.log(`[project-server] Servidor de projetos rodando em http://localhost:${config.port}`);
});
