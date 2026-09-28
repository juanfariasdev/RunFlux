import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { prisma } from '../db.js';

/** Values stored in clear before feature 015 are sealed at startup (RN-10, RF-10). */
describe('VariableValueMigration', () => {
  const container = createContainer(loadConfig());

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  async function legacyProject(name: string, envVars: unknown, archived = false): Promise<string> {
    const row = await prisma.project.create({ data: { name, envVars: JSON.stringify(envVars), archivedAt: archived ? new Date() : null } });
    return row.id;
  }

  const column = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).envVars ?? '';

  it('seals every clear value, archived projects included, and keeps the values', async () => {
    const active = await legacyProject('Legacy', [
      { key: 'DB_URL', value: 'legacy-marker-postgres', description: 'Orders' },
      { key: 'EMPTY', value: '' },
    ]);
    const archived = await legacyProject('Archived', [{ key: 'TOKEN', value: 'legacy-marker-token' }], true);

    expect(await container.migration.run()).toEqual({ sealed: 2, projects: 2 });

    expect(await column(active)).not.toContain('legacy-marker-postgres');
    expect(await column(archived)).not.toContain('legacy-marker-token');
    expect(JSON.parse(await column(active))).toEqual([
      { key: 'DB_URL', description: 'Orders', sealed: expect.stringMatching(/^v1\./) },
      { key: 'EMPTY' },
    ]);
    expect(await container.projects.projectEnvironment(active)).toEqual({ values: { DB_URL: 'legacy-marker-postgres', EMPTY: '' }, unreadable: [] });
    expect((await container.projects.getProjectEnv(archived))).toEqual([{ key: 'TOKEN', hasValue: true }]);
  });

  it('leaves no clear value in the database file', async () => {
    await legacyProject('Legacy file', [{ key: 'DB_URL', value: 'legacy-file-marker-91c2' }]);
    await container.migration.run();
    const file = new URL(process.env.DATABASE_URL!).pathname;
    expect(fs.readFileSync(file).includes('legacy-file-marker-91c2')).toBe(false);
  });

  it('seals nothing the second time', async () => {
    await legacyProject('Legacy', [{ key: 'DB_URL', value: 'x' }]);
    await container.migration.run();
    expect(await container.migration.run()).toEqual({ sealed: 0, projects: 0 });
  });

  it('reads a legacy value before the migration runs', async () => {
    const id = await legacyProject('Not migrated', [{ key: 'DB_URL', value: 'still-clear' }]);
    expect(await container.projects.getProjectEnv(id)).toEqual([{ key: 'DB_URL', hasValue: true }]);
    expect((await container.projects.projectEnvironment(id)).values).toEqual({ DB_URL: 'still-clear' });
  });
});
