import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

export default function setup(project: TestProject) {
  const directory = mkdtempSync(join(tmpdir(), 'runflux-server-test-'));
  const databaseUrl = `file:${join(directory, 'test.db')}`;
  writeFileSync(join(directory, 'test.db'), '');
  project.config.env = { ...project.config.env, DATABASE_URL: databaseUrl, RUNFLUX_OUTPUT_DIR: join(directory, 'backends') };
  try {
    execFileSync(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: project.config.root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return () => rmSync(directory, { recursive: true, force: true });
}
