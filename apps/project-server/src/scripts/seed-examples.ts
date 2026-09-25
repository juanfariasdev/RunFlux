import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { prisma } from '../db.js';

// npm run examples:seed — stores the workflows of examples/ as projects of the editor.
try {
  for (const example of await createContainer(loadConfig()).examples.seed()) {
    console.log(`[examples] ${example.action.padEnd(9)} ${example.name} (${example.projectId}) from ${example.file}`);
  }
} finally {
  await prisma.$disconnect();
}
