import type { PrismaClient } from '@prisma/client';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import type { ServerConfig } from './config.js';
import { prisma } from './db.js';
import { ExampleSeeder } from './examples/example-seeder.js';
import { ProjectRepository } from './repositories/project-repository.js';
import { SecretKeySource } from './secrets/secret-key-source.js';
import { AesGcmValueCipher } from './secrets/value-cipher.js';
import { CompilerService } from './services/compiler-service.js';
import { ProjectService } from './services/project-service.js';
import { ProjectVariables } from './services/project-variables.js';
import { VariableValueMigration } from './services/variable-value-migration.js';

/** The services the HTTP server routes to. */
export interface ServerServices {
  readonly projects: ProjectService;
  readonly compiler: CompilerService;
  /** Receives the requests sent to webhook test URLs. */
  readonly webhooks: WebhookTestHub;
}

export interface Container extends ServerServices {
  readonly examples: ExampleSeeder;
  /** Seals the values stored in clear before feature 015; run it before serving. */
  readonly migration: VariableValueMigration;
}

/**
 * The composition root: the one place that builds the project server's infrastructure. The key
 * that seals project variables comes from `env` (D-07); a bad key throws `ConfigurationError`.
 */
export function createContainer(config: ServerConfig, db: PrismaClient = prisma, env: NodeJS.ProcessEnv = process.env): Container {
  const repository = new ProjectRepository(db);
  const variables = new ProjectVariables(new AesGcmValueCipher(new SecretKeySource(env).load()));
  const projects = new ProjectService(repository, variables);
  return {
    projects,
    migration: new VariableValueMigration(repository, variables),
    compiler: new CompilerService(undefined, config.outputDirectory),
    webhooks: new WebhookTestHub(),
    examples: new ExampleSeeder(projects),
  };
}
