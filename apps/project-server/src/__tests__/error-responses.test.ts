import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { prisma } from '../db.js';
import { createServer } from '../server.js';

/** Pins the exact error bodies clients receive: `{ error: { code, message, details } }`. */
describe('error responses', () => {
  const app = createServer(createContainer(loadConfig()));

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  it('answers 404 for an unknown project', async () => {
    const response = await request(app).get('/api/projects/missing');
    expect([response.status, response.body]).toEqual([404, { error: { code: 'PROJECT_NOT_FOUND', message: "Projeto 'missing' não encontrado", details: null } }]);
  });

  it('answers 409 for a name already taken and 400 for an empty name', async () => {
    await request(app).post('/api/projects').send({ name: 'Taken' });
    const conflict = await request(app).post('/api/projects').send({ name: 'Taken' });
    expect([conflict.status, conflict.body]).toEqual([409, { error: { code: 'PROJECT_NAME_CONFLICT', message: "Já existe um projeto ativo com o nome 'Taken'", details: null } }]);
    const empty = await request(app).post('/api/projects').send({ name: ' ' });
    expect([empty.status, empty.body]).toEqual([400, { error: { code: 'INVALID_PAYLOAD', message: 'Nome do projeto não pode ser vazio', details: null } }]);
  });

  it('answers 400 with the zod issues for invalid variables', async () => {
    const created = await request(app).post('/api/projects').send({ name: 'Vars' });
    const response = await request(app).put(`/api/projects/${created.body.id}/env`).send({ envVars: [{ key: '1x' }] });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'INVALID_PAYLOAD', message: '0.key: Nome da variável deve ser um identificador válido (ex: API_KEY)' });
    expect(response.body.error.details).toHaveLength(1);
  });

  it('answers compiler errors with their own status, code and details', async () => {
    const target = await request(app).post('/api/compiler/compile').send({ workflow: { nodes: [], connections: [] }, targetPlatform: 'mars' });
    expect([target.status, target.body]).toEqual([400, { error: { code: 'UNSUPPORTED_TARGET', message: 'Plataforma alvo inválida: "mars". Suportadas: local, aws.', details: null } }]);
    const invalid = await request(app).post('/api/compiler/compile').send({ workflow: { nodes: 'no' } });
    expect([invalid.status, invalid.body.error.code, invalid.body.error.details]).toEqual([400, 'VALIDATION_ERROR', null]);
  });
});
