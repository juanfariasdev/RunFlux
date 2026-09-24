import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../db.js';
import { createServer } from '../server.js';

describe('Project Environment Variables API (011-env-vars-secrets)', () => {
  const app = createServer();

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  it('allows getting and setting project environment variables', async () => {
    const createRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Env Var Test Project' });

    expect(createRes.status).toBe(201);
    const projectId = createRes.body.id;

    // 1. Initial GET should be empty array
    const initialGet = await request(app).get(`/api/projects/${projectId}/env`);
    expect(initialGet.status).toBe(200);
    expect(initialGet.body.envVars).toEqual([]);

    // 2. PUT to update env vars
    const envPayload = [
      { key: 'STRIPE_API_KEY', value: 'sk_test_123', description: 'Stripe Secret Key' },
      { key: 'DATABASE_URL', value: 'postgres://localhost:5432/mydb', description: 'Database Connection' },
    ];

    const putRes = await request(app)
      .put(`/api/projects/${projectId}/env`)
      .send({ envVars: envPayload });

    expect(putRes.status).toBe(200);
    expect(putRes.body.envVars).toHaveLength(2);
    expect(putRes.body.envVars[0].key).toBe('STRIPE_API_KEY');

    // 3. GET should return updated variables
    const updatedGet = await request(app).get(`/api/projects/${projectId}/env`);
    expect(updatedGet.status).toBe(200);
    expect(updatedGet.body.envVars).toEqual(envPayload);

    // 4. GET project details should also contain envVars
    const projectDetails = await request(app).get(`/api/projects/${projectId}`);
    expect(projectDetails.status).toBe(200);
    expect(projectDetails.body.envVars).toEqual(envPayload);
  });

  it('rejects invalid env var identifiers with 400', async () => {
    const createRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Validation Test Project' });
    const projectId = createRes.body.id;

    const invalidPayload = [
      { key: '123_INVALID', value: 'bad' },
    ];

    const res = await request(app)
      .put(`/api/projects/${projectId}/env`)
      .send({ envVars: invalidPayload });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYLOAD');
  });

  it('preserves envVars across export and import', async () => {
    const createRes = await request(app)
      .post('/api/projects')
      .send({
        name: 'Exportable Env Project',
        definition: { nodes: [], connections: [] },
      });
    const projectId = createRes.body.id;

    await request(app)
      .put(`/api/projects/${projectId}/env`)
      .send([
        { key: 'API_SECRET', value: 'super-secret', description: 'Main API secret' },
      ]);

    // Export
    const exportRes = await request(app).get(`/api/projects/${projectId}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.project.envVars).toEqual([
      { key: 'API_SECRET', value: 'super-secret', description: 'Main API secret' },
    ]);

    // Import
    const importRes = await request(app).post('/api/projects/import').send(exportRes.body);
    expect(importRes.status).toBe(201);
    expect(importRes.body.envVars).toEqual([
      { key: 'API_SECRET', value: 'super-secret', description: 'Main API secret' },
    ]);
  });

  it('returns 404 when querying env for non-existent project', async () => {
    const res = await request(app).get('/api/projects/non-existent-uuid/env');
    expect(res.status).toBe(404);
  });
});
