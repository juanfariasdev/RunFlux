import type { Prisma, PrismaClient } from '@prisma/client';

export class ProjectRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: { name: string; currentWorkflowVersion?: string }) {
    return this.db.project.create({
      data: {
        name: data.name,
        currentWorkflowVersion: data.currentWorkflowVersion,
      },
    });
  }

  async findById(id: string) {
    return this.db.project.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { savedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findByName(name: string, archived: boolean = false) {
    return this.db.project.findFirst({
      where: {
        name,
        archivedAt: archived ? { not: null } : null,
      },
    });
  }

  async findMany(options: { archived?: boolean; search?: string } = {}) {
    const { archived = false, search } = options;

    const where: Prisma.ProjectWhereInput = {
      archivedAt: archived ? { not: null } : null,
      ...(search
        ? {
            name: {
              contains: search,
            },
          }
        : {}),
    };

    return this.db.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          orderBy: { savedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async update(id: string, data: { name?: string; currentWorkflowVersion?: string; envVars?: string }) {
    return this.db.project.update({
      where: { id },
      data,
    });
  }

  async archive(id: string) {
    return this.db.project.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async restore(id: string) {
    return this.db.project.update({
      where: { id },
      data: { archivedAt: null },
    });
  }

  async hardDelete(id: string) {
    return this.db.project.delete({
      where: { id },
    });
  }

  async createVersion(data: { projectId: string; version: string; definition: string }) {
    return this.db.workflowVersion.create({
      data: {
        projectId: data.projectId,
        version: data.version,
        definition: data.definition,
      },
    });
  }

  async getLatestVersion(projectId: string) {
    return this.db.workflowVersion.findFirst({
      where: { projectId },
      orderBy: { savedAt: 'desc' },
    });
  }

  async findByNamePrefix(prefix: string) {
    return this.db.project.findMany({
      where: {
        name: {
          startsWith: prefix,
        },
        archivedAt: null,
      },
      select: { name: true },
    });
  }
}
