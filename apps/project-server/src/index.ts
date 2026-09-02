import 'dotenv/config';
import { createServer } from './server.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const app = createServer();

app.listen(port, () => {
  console.log(`[project-server] Servidor de projetos rodando em http://localhost:${port}`);
});
