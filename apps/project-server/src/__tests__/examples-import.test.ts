import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { createServer } from '../server.js';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const files = fs.readdirSync(EXAMPLES).filter((file) => file.endsWith('.runflux.json')).sort();

describe.each(files)('example %s', (file) => {
  const app = createServer(createContainer(loadConfig()));
  const example = JSON.parse(fs.readFileSync(`${EXAMPLES}${file}`, 'utf8'));

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  async function imported() {
    const response = await request(app).post('/api/projects/import').send(example);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  }

  it('imports into a project that exports the same workflow and variables back', async () => {
    const project = await imported();
    expect(project.name).toBe(example.project.name);
    const exported = await request(app).get(`/api/projects/${project.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.body.project.envVars).toEqual(example.project.envVars);
    expect(exported.body.workflow.nodes).toEqual(example.workflow.nodes);
    expect(exported.body.workflow.connections).toEqual(example.workflow.connections);
  });

  it.each([['local', 'dist/server.mjs'], ['aws', 'dist/handler.mjs']])('compiles the imported project for %s, as the editor does, and serves its download', async (targetPlatform, entry) => {
    const project = await imported();
    const workflow = { ...project.workflow, settings: { envVars: project.envVars } };
    const compiled = await request(app).post('/api/compiler/compile').send({ workflow, targetPlatform, projectName: project.name });
    expect(compiled.status, JSON.stringify(compiled.body)).toBe(200);
    const download = await request(app).get(compiled.body.downloadUrl).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(download.status).toBe(200);
    const zip = await JSZip.loadAsync(download.body as Buffer);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([entry, 'src/workflow.json', 'package.json', 'README.md', 'vendor/runflux-runtime/plugins.js']));
    const document = JSON.parse(await zip.file('src/workflow.json')!.async('string'));
    expect(document.nodes.map((node: { id: string }) => node.id)).toEqual(example.workflow.nodes.map((node: { id: string }) => node.id));
  });
});
