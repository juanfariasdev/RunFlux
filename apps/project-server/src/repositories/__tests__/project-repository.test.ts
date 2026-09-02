import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db.js';
import { ProjectRepository } from '../project-repository.js';

describe('ProjectRepository', () => {
  const repo = new ProjectRepository(prisma);

  beforeEach(async () => {
    await prisma.workflowVersion.deleteMany();
    await prisma.project.deleteMany();
  });

  it('creates and finds a project by id', async () => {
    const project = await repo.create({ name: 'Test Project' });
    expect(project.id).toBeDefined();
    expect(project.name).toBe('Test Project');
    expect(project.archivedAt).toBeNull();

    const found = await repo.findById(project.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(project.id);
    expect(found?.name).toBe('Test Project');
  });

  it('filters active vs archived projects in findMany', async () => {
    const p1 = await repo.create({ name: 'Active Project' });
    const p2 = await repo.create({ name: 'To Archive' });
    await repo.archive(p2.id);

    const activeList = await repo.findMany({ archived: false });
    expect(activeList.length).toBe(1);
    expect(activeList[0].name).toBe('Active Project');

    const archivedList = await repo.findMany({ archived: true });
    expect(archivedList.length).toBe(1);
    expect(archivedList[0].name).toBe('To Archive');
  });

  it('archives and restores a project', async () => {
    const p = await repo.create({ name: 'Project 1' });
    const archived = await repo.archive(p.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await repo.restore(p.id);
    expect(restored.archivedAt).toBeNull();
  });

  it('creates workflow versions and cascades deletion', async () => {
    const p = await repo.create({ name: 'Versioned Project' });
    const v1 = await repo.createVersion({
      projectId: p.id,
      version: 'v1',
      definition: JSON.stringify({ nodes: [], connections: [] }),
    });
    expect(v1.id).toBeDefined();
    expect(v1.version).toBe('v1');

    await repo.update(p.id, { currentWorkflowVersion: 'v1' });
    const found = await repo.findById(p.id);
    expect(found?.versions.length).toBe(1);
    expect(found?.versions[0].version).toBe('v1');

    await repo.hardDelete(p.id);
    const deletedProject = await repo.findById(p.id);
    expect(deletedProject).toBeNull();

    const versionsRemaining = await prisma.workflowVersion.findMany({
      where: { projectId: p.id },
    });
    expect(versionsRemaining.length).toBe(0);
  });

  it('finds projects matching name prefix', async () => {
    await repo.create({ name: 'Fluxo' });
    await repo.create({ name: 'Fluxo (1)' });
    await repo.create({ name: 'Fluxo (2)' });
    await repo.create({ name: 'Outro' });

    const matches = await repo.findByNamePrefix('Fluxo');
    expect(matches.length).toBe(3);
    const names = matches.map((m) => m.name);
    expect(names).toContain('Fluxo');
    expect(names).toContain('Fluxo (1)');
    expect(names).toContain('Fluxo (2)');
  });
});
