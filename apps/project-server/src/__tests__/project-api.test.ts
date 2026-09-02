import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../db.js';
import { createServer } from '../server.js';

describe('Project REST API', () => {
  const app = createServer();

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  it('handles full lifecycle: create, list, update, export, archive, restore, delete', async () => {
    // 1. Create
    const createRes = await request(app)
      .post('/api/projects')
      .send({
        name: 'Projeto Lifecycle',
        definition: {
          nodes: [
            {
              id: 'node-1',
              pluginId: 'trigger-manual-example',
              position: { x: 0, y: 0 },
            },
          ],
          connections: [],
        },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toBeDefined();
    expect(createRes.body.name).toBe('Projeto Lifecycle');
    const projectId = createRes.body.id;

    // 2. List
    const listRes = await request(app).get('/api/projects');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].nodeCount).toBe(1);

    // 3. Get by ID
    const getRes = await request(app).get(`/api/projects/${projectId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.workflow.nodes.length).toBe(1);

    // 4. Update
    const updateRes = await request(app)
      .put(`/api/projects/${projectId}`)
      .send({
        name: 'Projeto Atualizado',
        definition: {
          nodes: [
            {
              id: 'node-1',
              pluginId: 'trigger-manual-example',
              position: { x: 0, y: 0 },
            },
            {
              id: 'node-2',
              pluginId: 'log-output',
              position: { x: 100, y: 100 },
            },
          ],
          connections: [],
        },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Projeto Atualizado');
    expect(updateRes.body.currentWorkflowVersion).toBe('v2');
    expect(updateRes.body.workflow.nodes.length).toBe(2);

    // 5. Export
    const exportRes = await request(app).get(`/api/projects/${projectId}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.schemaVersion).toBe(1);
    expect(exportRes.body.project.name).toBe('Projeto Atualizado');

    // 6. Import (deve resolver colisão virando "Projeto Atualizado (1)")
    const importRes = await request(app).post('/api/projects/import').send(exportRes.body);
    expect(importRes.status).toBe(201);
    expect(importRes.body.name).toBe('Projeto Atualizado (1)');
    expect(importRes.body.workflow.nodes.length).toBe(2);

    // 7. Archive
    const archiveRes = await request(app).post(`/api/projects/${projectId}/archive`);
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.status).toBe('archived');

    // Não deve aparecer na lista ativa
    const activeList = await request(app).get('/api/projects');
    expect(activeList.body.some((p: any) => p.id === projectId)).toBe(false);

    // Deve aparecer na lixeira
    const trashList = await request(app).get('/api/projects?archived=true');
    expect(trashList.body.some((p: any) => p.id === projectId)).toBe(true);

    // 8. Restore
    const restoreRes = await request(app).post(`/api/projects/${projectId}/restore`);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.status).toBe('active');

    // 9. Hard Delete
    await request(app).post(`/api/projects/${projectId}/archive`);
    const deleteRes = await request(app).delete(`/api/projects/${projectId}`);
    expect(deleteRes.status).toBe(204);

    const getDeleted = await request(app).get(`/api/projects/${projectId}`);
    expect(getDeleted.status).toBe(404);
    expect(getDeleted.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('returns 409 Conflict on duplicate active project name', async () => {
    await request(app).post('/api/projects').send({ name: 'Mesmo Nome' });
    const duplicate = await request(app).post('/api/projects').send({ name: 'Mesmo Nome' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PROJECT_NAME_CONFLICT');
  });
});
