import type { PrismaClient } from '@prisma/client';
import type { ServerConfig } from './config.js';
import { prisma } from './db.js';
import { ExampleSeeder } from './examples/example-seeder.js';
import { ProjectRepository } from './repositories/project-repository.js';
import { CompilerService } from './services/compiler-service.js';
import { ProjectService } from './services/project-service.js';

/** The services the HTTP server routes to. */
export interface ServerServices {
  readonly projects: ProjectService;
  readonly compiler: CompilerService;
}

export interface Container extends ServerServices {
  readonly examples: ExampleSeeder;
}

/** The composition root: the one place that builds the project server's infrastructure. */
export function createContainer(config: ServerConfig, db: PrismaClient = prisma): Container {
  const projects = new ProjectService(new ProjectRepository(db));
  return {
    projects,
    compiler: new CompilerService(undefined, config.outputDirectory),
    examples: new ExampleSeeder(projects),
  };
}
