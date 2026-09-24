import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db.js';
import { ProjectService, ProjectConflictError, ValidationError, ProjectNotFoundError } from '../project-service.js';

describe('ProjectService', () => {
  const service = new ProjectService();

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  it('creates project with definition and sets version to v1', async () => {
    const project = await service.createProject({
      name: 'Workflow 1',
      definition: {
        id: '',
        name: 'Workflow 1',
        nodes: [
          {
            id: 'n1',
            pluginId: 'trigger-manual-example',
            pluginVersion: '1.0.0',
            parameters: {},
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
      },
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe('Workflow 1');
    expect(project.currentWorkflowVersion).toBe('v1');
    expect(project.workflow.nodes.length).toBe(1);
    expect(project.workflow.nodes[0].id).toBe('n1');
  });

  it('throws ValidationError for empty name', async () => {
    await expect(
      service.createProject({ name: '   ' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws ProjectConflictError for duplicate active name', async () => {
    await service.createProject({ name: 'Duplicate' });
    await expect(
      service.createProject({ name: 'Duplicate' })
    ).rejects.toThrow(ProjectConflictError);
  });

  it('updates project definition and increments version to v2', async () => {
    const p = await service.createProject({
      name: 'Versioned Workflow',
      definition: { id: '', name: 'Versioned Workflow', nodes: [], connections: [] },
    });
    expect(p.currentWorkflowVersion).toBe('v1');

    const updated = await service.updateProject(p.id, {
      definition: {
        id: p.id,
        name: 'Versioned Workflow',
        nodes: [
          {
            id: 'n2',
            pluginId: 'log-output',
            pluginVersion: '1.0.0',
            parameters: {},
            position: { x: 50, y: 50 },
          },
        ],
        connections: [],
      },
    });

    expect(updated.currentWorkflowVersion).toBe('v2');
    expect(updated.workflow.nodes.length).toBe(1);
    expect(updated.workflow.nodes[0].id).toBe('n2');
  });

  it('normalizes legacy database connection variables to $env expressions', async () => {
    const project = await prisma.project.create({
      data: { name: 'Legacy Database Workflow', currentWorkflowVersion: 'v1' },
    });
    await prisma.workflowVersion.create({
      data: {
        projectId: project.id,
        version: 'v1',
        definition: JSON.stringify({
          id: '',
          name: project.name,
          nodes: [{
            id: 'db',
            pluginId: 'database-query',
            pluginVersion: '1.0.0',
            parameters: { connectionEnvVar: 'DATABASE_URL', query: 'SELECT 1' },
            position: { x: 0, y: 0 },
          }],
          connections: [],
        }),
      },
    });

    const loaded = await service.getProject(project.id);
    expect(loaded.workflow.nodes[0].parameters.connectionEnvVar).toBe('{{$env.DATABASE_URL}}');

    const saved = await service.updateProject(project.id, { definition: loaded.workflow });
    expect(saved.workflow.nodes[0].parameters.connectionEnvVar).toBe('{{$env.DATABASE_URL}}');
    const latest = await prisma.workflowVersion.findFirst({ where: { projectId: project.id }, orderBy: { savedAt: 'desc' } });
    expect(JSON.parse(latest!.definition).nodes[0].parameters.connectionEnvVar).toBe('{{$env.DATABASE_URL}}');
  });

  it('exports and imports project with automatic name collision handling', async () => {
    const original = await service.createProject({
      name: 'Importable Workflow',
      definition: {
        id: '',
        name: 'Importable Workflow',
        nodes: [
          {
            id: 'node-10',
            pluginId: 'trigger-manual-example',
            pluginVersion: '1.0.0',
            parameters: {},
            position: { x: 10, y: 20 },
          },
        ],
        connections: [],
      },
    });

    const exported = await service.exportProject(original.id);
    expect(exported.schemaVersion).toBe(1);
    expect(exported.project.name).toBe('Importable Workflow');
    expect(exported.workflow.nodes.length).toBe(1);

    // Import while original is still active -> should rename to "Importable Workflow (1)"
    const imported = await service.importProject(exported);
    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe('Importable Workflow (1)');
    expect(imported.workflow.nodes[0].id).toBe('node-10');

    // Import again -> should become "Importable Workflow (2)"
    const imported2 = await service.importProject(exported);
    expect(imported2.name).toBe('Importable Workflow (2)');
  });

  it('rejects corrupted import payload', async () => {
    await expect(service.importProject({ invalid: true })).rejects.toThrow(ValidationError);
  });

  it('archives and restores projects properly', async () => {
    const p = await service.createProject({ name: 'Archivable Workflow' });
    await service.archiveProject(p.id);

    const active = await service.listProjects({ archived: false });
    expect(active.some((item) => item.id === p.id)).toBe(false);

    const archived = await service.listProjects({ archived: true });
    expect(archived.some((item) => item.id === p.id)).toBe(true);

    await service.restoreProject(p.id);
    const restoredActive = await service.listProjects({ archived: false });
    expect(restoredActive.some((item) => item.id === p.id)).toBe(true);
  });
});
