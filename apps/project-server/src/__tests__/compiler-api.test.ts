import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { createServer } from '../server.js';

describe('Compiler REST API', () => {
  const app = createServer(createContainer(loadConfig()));

  const validWorkflow = {
    id: 'wf-compile-api',
    name: 'Backend Test API',
    nodes: [
      {
        id: 'n1',
        pluginId: 'trigger-manual-example',
        pluginVersion: '1.0.0',
        parameters: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        pluginId: 'set',
        pluginVersion: '1.0.0',
        parameters: { fields: [{ name: 'result', value: 'success' }] },
        position: { x: 100, y: 0 },
      },
    ],
    connections: [
      {
        sourceNodeId: 'n1',
        sourceOutput: 'main',
        targetNodeId: 'n2',
        targetInput: 'main',
      },
    ],
  };

  it('compiles workflow, creates disk output and returns download url', async () => {
    const res = await request(app)
      .post('/api/compiler/compile')
      .send({
        workflow: validWorkflow,
        targetPlatform: 'local',
        projectName: 'Backend Test API',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.targetPlatform).toBe('local');
    expect(res.body.zipFilename).toBe('Backend Test API-local.zip');
    expect(res.body.downloadUrl).toBe(`/api/compiler/downloads/${res.body.compilationId}/Backend%20Test%20API-local.zip`);

    const outputDir = res.body.outputDirectory;
    expect(fs.existsSync(outputDir)).toBe(true);

    const zipPath = path.join(outputDir, res.body.zipFilename);
    expect(fs.existsSync(zipPath)).toBe(true);

    // Test downloading the zip
    const downloadRes = await request(app)
      .get(res.body.downloadUrl)
      .responseType('blob');

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('application/zip');

    const legacy = await request(app).get('/api/compiler/downloads/Backend%20Test%20API-local.zip').responseType('blob');
    expect(legacy.status).toBe(200);
    const percent = await request(app).get(`/api/compiler/downloads/${res.body.compilationId}/100%25.zip`);
    expect(percent.status).toBe(404);
    expect(percent.body.error.message).toContain('"100%.zip"');
  });

  it('answers with the compiler error code and a status telling client and server errors apart', async () => {
    const invalid = await request(app).post('/api/compiler/compile').send({ workflow: { nodes: 'none' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    const cyclic = await request(app).post('/api/compiler/compile').send({
      workflow: { ...validWorkflow, connections: [...validWorkflow.connections, { sourceNodeId: 'n2', sourceOutput: 'main', targetNodeId: 'n1', targetInput: 'main' }] },
      targetPlatform: 'local',
    });
    expect(cyclic.status).toBe(400);
    expect(cyclic.body.error.code).toBe('CYCLE_DETECTED');
  });

  it('returns 400 when an incompatible node is present for target platform', async () => {
    const incompatibleWorkflow = {
      ...validWorkflow,
      nodes: [
        {
          id: 'n-unknown',
          pluginId: 'non-existent-plugin',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
        },
      ],
    };

    const res = await request(app)
      .post('/api/compiler/compile')
      .send({
        workflow: incompatibleWorkflow,
        targetPlatform: 'aws',
        projectName: 'Fail Test',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INCOMPATIBLE_NODES');
  });
});
