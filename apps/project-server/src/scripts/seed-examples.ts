import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { prisma } from '../db.js';

// npm run examples:seed — stores the workflows of examples/ as projects of the editor.
try {
  const container = createContainer(loadConfig());
  // Values stored in clear before feature 015 are sealed first, as the server does at startup.
  await container.migration.run();
  for (const example of await container.examples.seed()) {
    console.log(`[examples] ${example.action.padEnd(9)} ${example.name} (${example.projectId}) from ${example.file}`);
  }
} finally {
  await prisma.$disconnect();
}
