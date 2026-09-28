import type { EnvVarUpdate, ProjectEnvVarView } from '@runflux/workflow-model/schema';
import type { ValueCipher } from '../secrets/value-cipher.js';

/**
 * A variable as `Project.envVars` stores it (D-08). `sealed` holds the encrypted value; an entry
 * with a clear `value` is legacy, from before feature 015, until the startup migration seals it.
 */
export interface StoredEnvVar {
  readonly key: string;
  readonly description?: string;
  readonly sealed?: string;
  /** Legacy clear value. */
  readonly value?: string;
}

/** The values a test run reads as `$env`, and the names whose sealed value the current key cannot open. */
export interface ProjectEnvironment {
  readonly values: Record<string, string>;
  readonly unreadable: string[];
}

/**
 * The rules of a project's variable list (D-09): values are sealed on write and never returned,
 * an update keeps the values it does not send (RN-08), and only test runs get the values back.
 */
export class ProjectVariables {
  constructor(private readonly cipher: ValueCipher) {}

  /** The stored list; missing or unreadable JSON reads as an empty list (DB-07). */
  read(stored: string | null): StoredEnvVar[] {
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((entry): entry is StoredEnvVar => typeof entry?.key === 'string') : [];
    } catch {
      return [];
    }
  }

  views(projectId: string, stored: string | null): ProjectEnvVarView[] {
    return this.read(stored).map((entry) => {
      const view: ProjectEnvVarView = { key: entry.key, ...describe(entry), hasValue: hasValue(entry) };
      if (entry.sealed !== undefined && !this.opens(projectId, entry)) view.unreadable = true;
      return view;
    });
  }

  /**
   * The list after an update: a variable sent with a value gets it (empty text clears it), one
   * sent without keeps its stored value, and one left out is removed. A renamed variable has no
   * value, since its sealed text is bound to the old name.
   */
  apply(projectId: string, stored: string | null, updates: readonly EnvVarUpdate[]): string {
    const current = new Map(this.read(stored).map((entry) => [entry.key, entry]));
    return serialize(updates.map((update) => {
      const description = update.description?.trim() ? update.description : undefined;
      if (update.value !== undefined) return this.entry(projectId, update.key, description, update.value);
      const existing = current.get(update.key);
      if (existing?.value !== undefined) return this.entry(projectId, update.key, description, existing.value);
      return { key: update.key, ...(description ? { description } : {}), ...(existing?.sealed ? { sealed: existing.sealed } : {}) };
    }));
  }

  /** The values for test runs: `''` for a variable without one; undecryptable names listed apart. */
  environment(projectId: string, stored: string | null): ProjectEnvironment {
    const values: Record<string, string> = {};
    const unreadable: string[] = [];
    for (const entry of this.read(stored)) {
      if (entry.value !== undefined) values[entry.key] = entry.value;
      else if (entry.sealed === undefined) values[entry.key] = '';
      else {
        try {
          values[entry.key] = this.cipher.open(entry.sealed, context(projectId, entry.key));
        } catch {
          unreadable.push(entry.key);
        }
      }
    }
    return { values, unreadable };
  }

  /** The list an exported `.runflux.json` carries: names and descriptions, never values (RN-11). */
  exported(stored: string | null): Array<{ key: string; description?: string }> {
    return this.read(stored).map((entry) => ({ key: entry.key, ...describe(entry) }));
  }

  /** The list with every legacy clear value sealed, or null when nothing needs sealing (D-10). */
  migrate(projectId: string, stored: string | null): { stored: string; sealed: number } | null {
    const entries = this.read(stored);
    if (!entries.some((entry) => entry.value !== undefined)) return null;
    let sealed = 0;
    const migrated = entries.map((entry) => {
      if (entry.value === undefined) return entry;
      if (entry.value !== '') sealed++;
      return this.entry(projectId, entry.key, entry.description, entry.value);
    });
    return { stored: serialize(migrated), sealed };
  }

  private entry(projectId: string, key: string, description: string | undefined, value: string): StoredEnvVar {
    return { key, ...(description ? { description } : {}), ...(value !== '' ? { sealed: this.cipher.seal(value, context(projectId, key)) } : {}) };
  }

  private opens(projectId: string, entry: StoredEnvVar): boolean {
    try {
      this.cipher.open(entry.sealed!, context(projectId, entry.key));
      return true;
    } catch {
      return false;
    }
  }
}

/** The additional data a value is sealed with: its project and its name. */
function context(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

function hasValue(entry: StoredEnvVar): boolean {
  return entry.sealed !== undefined || (entry.value !== undefined && entry.value !== '');
}

function describe(entry: StoredEnvVar): { description?: string } {
  return entry.description ? { description: entry.description } : {};
}

function serialize(entries: readonly StoredEnvVar[]): string {
  return JSON.stringify(entries);
}
