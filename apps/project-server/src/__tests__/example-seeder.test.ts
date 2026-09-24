import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { EXAMPLES_DIRECTORY, ExampleSeeder } from '../examples/example-seeder.js';
import { ProjectService } from '../services/project-service.js';

describe('ExampleSeeder', () => {
  const projects = new ProjectService();
  let directory: string;

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-examples-'));
    await fs.cp(EXAMPLES_DIRECTORY, directory, { recursive: true });
  });

  afterEach(() => fs.rm(directory, { recursive: true, force: true }));

  const seeder = () => new ExampleSeeder(projects, directory);
  const example = async (file: string) => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));

  it('creates one project per example with its workflow and variables', async () => {
    const seeded = await seeder().seed();
    expect(seeded.map(({ file, action }) => [file, action])).toEqual([
      ['database-crud.runflux.json', 'created'], ['http-api.runflux.json', 'created'], ['switch-routing.runflux.json', 'created'],
    ]);
    for (const { file, projectId } of seeded) {
      const [stored, source] = await Promise.all([projects.getProject(projectId), example(file)]);
      expect(stored.name).toBe(source.project.name);
      expect(stored.workflow.nodes).toEqual(source.workflow.nodes);
      expect(stored.workflow.connections).toEqual(source.workflow.connections);
      expect(stored.envVars).toEqual(source.project.envVars);
      expect(stored.currentWorkflowVersion).toBe('v1');
    }
  });

  it('changes nothing when the projects already match their examples', async () => {
    await seeder().seed();
    const again = await seeder().seed();
    expect(again.map((seeded) => seeded.action)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(await prisma.project.count()).toBe(3);
    expect(await prisma.workflowVersion.count()).toBe(3);
  });

  it('stores a changed example as a new version and adds its new variables, keeping configured values', async () => {
    const [, http] = await seeder().seed();
    await projects.updateProjectEnv(http.projectId, [{ key: 'ITEMS_API_KEY', value: 'my-secret' }, { key: 'UPSTREAM_URL', value: 'http://mine' }, { key: 'EXTRA', value: 'kept' }]);
    const source = await example('http-api.runflux.json');
    source.workflow.nodes[0].appearance.label = 'GET /items (renamed)';
    source.project.envVars.push({ key: 'NEW_VARIABLE', value: 'default', description: 'Added later' });
    await fs.writeFile(path.join(directory, 'http-api.runflux.json'), JSON.stringify(source));

    const reseeded = await seeder().seed();
    expect(reseeded.map((seeded) => seeded.action)).toEqual(['unchanged', 'updated', 'unchanged']);
    const stored = await projects.getProject(http.projectId);
    expect(stored.currentWorkflowVersion).toBe('v2');
    expect(stored.workflow.nodes[0].appearance?.label).toBe('GET /items (renamed)');
    expect(stored.envVars.map(({ key, value }) => [key, value])).toEqual([
      ['ITEMS_API_KEY', 'my-secret'], ['UPSTREAM_URL', 'http://mine'], ['NEW_VARIABLE', 'default'], ['EXTRA', 'kept'],
    ]);
  });

  it('refuses a file that is not a project file, naming it', async () => {
    await fs.writeFile(path.join(directory, 'broken.runflux.json'), JSON.stringify({ schemaVersion: 2 }));
    await expect(seeder().seed()).rejects.toThrow('broken.runflux.json is not a RunFlux project file');
  });
});
