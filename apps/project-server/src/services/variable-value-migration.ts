import type { ProjectRepository } from '../repositories/project-repository.js';
import type { ProjectVariables } from './project-variables.js';

export interface MigrationResult {
  /** Values sealed in this run. */
  readonly sealed: number;
  /** Projects rewritten in this run. */
  readonly projects: number;
}

/**
 * Seals the variable values stored in clear before feature 015 (D-10, RN-10). It runs at every
 * start and does nothing once every value is sealed. After sealing, the database file is rebuilt,
 * so the clear text does not stay in the pages the old rows used.
 */
export class VariableValueMigration {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly variables: ProjectVariables,
  ) {}

  async run(): Promise<MigrationResult> {
    let sealed = 0;
    let projects = 0;
    for (const project of await this.repo.findAllVariables()) {
      const migrated = this.variables.migrate(project.id, project.envVars);
      if (!migrated) continue;
      await this.repo.replaceVariables(project.id, migrated.stored, project.updatedAt);
      sealed += migrated.sealed;
      projects++;
    }
    if (projects > 0) await this.repo.compact();
    return { sealed, projects };
  }
}
