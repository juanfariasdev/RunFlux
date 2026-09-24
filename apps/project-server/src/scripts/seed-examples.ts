import 'dotenv/config';
import { prisma } from '../db.js';
import { ExampleSeeder } from '../examples/example-seeder.js';

// npm run examples:seed — stores the workflows of examples/ as projects of the editor.
try {
  for (const example of await new ExampleSeeder().seed()) {
    console.log(`[examples] ${example.action.padEnd(9)} ${example.name} (${example.projectId}) from ${example.file}`);
  }
} finally {
  await prisma.$disconnect();
}
