import fs from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../db.js';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { createServer } from '../server.js';

const SECRET = 'postgres://u:p@h/db';

/** Project variables are write-only in the API and sealed at rest (011-env-vars-secrets, 015 RF-07 to RF-09, RF-14). */
describe('Project Environment Variables API', () => {
  const container = createContainer(loadConfig());
  const app = createServer(container);

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  async function project(name = 'Env Var Test Project'): Promise<string> {
    const created = await request(app).post('/api/projects').send({ name, definition: { nodes: [], connections: [] } });
    expect(created.status).toBe(201);
    return created.body.id;
  }

  const put = (id: string, envVars: unknown) => request(app).put(`/api/projects/${id}/env`).send({ envVars });
  const values = (id: string) => container.projects.projectEnvironment(id);
  const storedColumn = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).envVars ?? '';

  it('starts empty, then reports whether each variable has a value, never the value', async () => {
    const id = await project();
    expect((await request(app).get(`/api/projects/${id}/env`)).body).toEqual({ envVars: [] });

    const saved = await put(id, [
      { key: 'DATABASE_URL', value: SECRET, description: 'Database Connection' },
      { key: 'OPTIONAL_FLAG', value: '' },
    ]);
    const views = [
      { key: 'DATABASE_URL', description: 'Database Connection', hasValue: true },
      { key: 'OPTIONAL_FLAG', hasValue: false },
    ];
    expect([saved.status, saved.body]).toEqual([200, { envVars: views }]);
    expect((await request(app).get(`/api/projects/${id}/env`)).body).toEqual({ envVars: views });
    expect((await request(app).get(`/api/projects/${id}`)).body.envVars).toEqual(views);
    expect(await values(id)).toEqual({ values: { DATABASE_URL: SECRET, OPTIONAL_FLAG: '' }, unreadable: [] });
  });

  it('never returns the text of a value, and never stores it in clear', async () => {
    const id = await project();
    const responses = [await put(id, [{ key: 'DATABASE_URL', value: SECRET }])];
    responses.push(await request(app).get(`/api/projects/${id}`), await request(app).get(`/api/projects/${id}/env`), await request(app).get(`/api/projects/${id}/export`));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.text).not.toContain(SECRET);
    }
    const column = await storedColumn(id);
    expect(column).toContain('"sealed"');
    expect(column).not.toContain(SECRET);
  });

  it('keeps a value sent without one, replaces it when sent, clears it with empty text and drops left-out variables', async () => {
    const id = await project();
    await put(id, [{ key: 'A', value: 'a1' }, { key: 'B', value: 'b1' }, { key: 'C', value: 'c1' }, { key: 'D', value: 'd1' }]);

    const updated = await put(id, [{ key: 'A' }, { key: 'B', value: 'b2' }, { key: 'C', value: '' }, { key: 'E', description: 'new' }]);
    expect(updated.body.envVars).toEqual([
      { key: 'A', hasValue: true },
      { key: 'B', hasValue: true },
      { key: 'C', hasValue: false },
      { key: 'E', description: 'new', hasValue: false },
    ]);
    expect((await values(id)).values).toEqual({ A: 'a1', B: 'b2', C: '', E: '' });
  });

  it('treats a renamed variable as a new one without a value', async () => {
    const id = await project();
    await put(id, [{ key: 'OLD_NAME', value: 'v' }]);
    const renamed = await put(id, [{ key: 'NEW_NAME' }]);
    expect(renamed.body.envVars).toEqual([{ key: 'NEW_NAME', hasValue: false }]);
  });

  it('rejects invalid identifiers and repeated names with 400', async () => {
    const id = await project();
    const invalid = await put(id, [{ key: '123_INVALID', value: 'bad' }]);
    expect([invalid.status, invalid.body.error.code]).toEqual([400, 'INVALID_PAYLOAD']);
    const repeated = await put(id, [{ key: 'A', value: '1' }, { key: 'A', value: '2' }]);
    expect([repeated.status, repeated.body.error.code]).toEqual([400, 'INVALID_PAYLOAD']);
  });

  it('accepts the bare array body the API took before', async () => {
    const id = await project();
    const response = await request(app).put(`/api/projects/${id}/env`).send([{ key: 'API_SECRET', value: 'super-secret' }]);
    expect(response.body.envVars).toEqual([{ key: 'API_SECRET', hasValue: true }]);
  });

  it('exports names and descriptions only, and imports an older file with values, sealing them', async () => {
    const id = await project('Exportable Env Project');
    await put(id, [{ key: 'API_SECRET', value: 'super-secret', description: 'Main API secret' }]);

    const exported = await request(app).get(`/api/projects/${id}/export`);
    expect(exported.body.project.envVars).toEqual([{ key: 'API_SECRET', description: 'Main API secret' }]);

    const older = { ...exported.body, project: { ...exported.body.project, envVars: [{ key: 'API_SECRET', value: 'super-secret', description: 'Main API secret' }] } };
    const imported = await request(app).post('/api/projects/import').send(older);
    expect(imported.status).toBe(201);
    expect(imported.body.envVars).toEqual([{ key: 'API_SECRET', description: 'Main API secret', hasValue: true }]);
    expect(imported.text).not.toContain('super-secret');
    expect(await values(imported.body.id)).toEqual({ values: { API_SECRET: 'super-secret' }, unreadable: [] });
    expect(await storedColumn(imported.body.id)).not.toContain('super-secret');
  });

  it('seals the variables a new project is created with, as import and the seeder create them', async () => {
    const created = await container.projects.createProject({ name: 'Created with values', envVars: [{ key: 'TOKEN', value: 'abc123' }] });
    expect(created.envVars).toEqual([{ key: 'TOKEN', hasValue: true }]);
    expect(await storedColumn(created.id)).not.toContain('abc123');
  });

  it('keeps the database file free of a saved value', async () => {
    const id = await project();
    await put(id, [{ key: 'DATABASE_URL', value: 'file-scan-marker-7f3a' }]);
    const file = new URL(process.env.DATABASE_URL!).pathname;
    expect(fs.readFileSync(file).includes('file-scan-marker-7f3a')).toBe(false);
  });

  it('returns 404 when querying env for non-existent project', async () => {
    const res = await request(app).get('/api/projects/non-existent-uuid/env');
    expect(res.status).toBe(404);
  });
});
