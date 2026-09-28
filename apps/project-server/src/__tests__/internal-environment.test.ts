import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { prisma } from '../db.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { AesGcmValueCipher } from '../secrets/value-cipher.js';
import { checkInternalAccess } from '../security/internal-guard.js';
import { createServer } from '../server.js';
import { ProjectService } from '../services/project-service.js';
import { ProjectVariables } from '../services/project-variables.js';

const TOKEN = 'a-token-that-is-long-enough-for-the-server';

/** The route that gives test runs their values (feature 015, RN-12, RF-18). */
describe('internal environment route', () => {
  const container = createContainer(loadConfig());

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  async function projectWith(envVars: { key: string; value?: string }[], service = container.projects): Promise<string> {
    const created = await service.createProject({ name: `Values ${Math.random()}` });
    await service.updateProjectEnv(created.id, envVars);
    return created.id;
  }

  it('gives a loopback caller without an origin the stored values', async () => {
    const id = await projectWith([{ key: 'DB_URL', value: 'postgres://u:p@h/db' }, { key: 'EMPTY', value: '' }]);
    const response = await request(createServer(container)).get(`/internal/projects/${id}/environment`);
    expect([response.status, response.body]).toEqual([200, { values: { DB_URL: 'postgres://u:p@h/db', EMPTY: '' }, unreadable: [] }]);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a request with an Origin header, as a browser page sends', async () => {
    const id = await projectWith([{ key: 'DB_URL', value: 'x' }]);
    const response = await request(createServer(container, { corsOrigins: ['http://evil.example'] })).get(`/internal/projects/${id}/environment`).set('Origin', 'http://evil.example');
    expect([response.status, response.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect(response.text).not.toContain('"x"');
  });

  it('requires the token when one is configured', async () => {
    const id = await projectWith([{ key: 'DB_URL', value: 'x' }]);
    const app = createServer(container, { apiToken: TOKEN });
    expect((await request(app).get(`/internal/projects/${id}/environment`)).status).toBe(401);
    const allowed = await request(app).get(`/internal/projects/${id}/environment`).set('Authorization', `Bearer ${TOKEN}`);
    expect(allowed.body.values).toEqual({ DB_URL: 'x' });
  });

  it('answers 404 for an unknown project', async () => {
    const response = await request(createServer(container)).get('/internal/projects/missing/environment');
    expect([response.status, response.body.error.code]).toEqual([404, 'PROJECT_NOT_FOUND']);
  });

  it('is not part of the API', async () => {
    const response = await request(createServer(container)).get('/api/internal/projects/x/environment');
    expect(response.status).toBe(404);
  });

  it('lists a value sealed under another key as unreadable', async () => {
    const other = new ProjectService(new ProjectRepository(prisma), new ProjectVariables(new AesGcmValueCipher(randomBytes(32))));
    const id = await projectWith([{ key: 'OLD_SECRET', value: 'lost' }, { key: 'EMPTY', value: '' }], other);
    const response = await request(createServer(container)).get(`/internal/projects/${id}/environment`);
    expect(response.body).toEqual({ values: { EMPTY: '' }, unreadable: ['OLD_SECRET'] });
    const views = (await request(createServer(container)).get(`/api/projects/${id}/env`)).body.envVars;
    expect(views).toEqual([{ key: 'OLD_SECRET', hasValue: true, unreadable: true }, { key: 'EMPTY', hasValue: false }]);
  });
});

describe('checkInternalAccess', () => {
  it('refuses a caller that is not on loopback, or that sends an Origin', () => {
    expect(checkInternalAccess({ remoteAddress: '192.168.1.10' })).toBe('forbidden');
    expect(checkInternalAccess({ remoteAddress: '::ffff:10.0.0.2' })).toBe('forbidden');
    expect(checkInternalAccess({ remoteAddress: '127.0.0.1', origin: 'http://localhost:5173' })).toBe('forbidden');
    expect(checkInternalAccess({ remoteAddress: undefined })).toBe('forbidden');
  });

  it('checks the token after the address', () => {
    expect(checkInternalAccess({ remoteAddress: '127.0.0.1' })).toBe('allowed');
    expect(checkInternalAccess({ remoteAddress: '::1' }, TOKEN)).toBe('unauthorized');
    expect(checkInternalAccess({ remoteAddress: '::1', authorization: `Bearer ${TOKEN}` }, TOKEN)).toBe('allowed');
    expect(checkInternalAccess({ remoteAddress: '10.0.0.2', authorization: `Bearer ${TOKEN}` }, TOKEN)).toBe('forbidden');
  });
});
