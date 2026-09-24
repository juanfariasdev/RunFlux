import { describe, it, expect } from 'vitest';
import { generators } from '../index.js';

describe('database-query generators (012-database-query-plugin)', () => {
  it('generates local artifact with pg connection pool and query', () => {
    const artifact = generators.local(
      {
        databaseType: 'postgres',
        connectionEnvVar: 'CUSTOM_DB_URL',
        query: 'SELECT id, email FROM customers WHERE active = true;',
        outputMode: 'all',
      },
      {} as any
    );

    expect(artifact.files).toHaveLength(1);
    const file = artifact.files[0];
    expect(file.path).toBe('database-query.ts');
    expect(file.content).toContain("import pg from 'pg';");
    expect(file.content).toContain('CUSTOM_DB_URL');
    expect(file.content).toContain('SELECT id, email FROM customers WHERE active = true;');
    expect(file.content).toContain('return rows;');
  });

  it('generates aws artifact with single-result extraction when outputMode is first', () => {
    const artifact = generators.aws(
      {
        databaseType: 'postgres',
        connectionEnvVar: 'DATABASE_URL',
        query: 'SELECT * FROM users WHERE id = $1;',
        outputMode: 'first',
      },
      {} as any
    );

    expect(artifact.files).toHaveLength(1);
    const file = artifact.files[0];
    expect(file.content).toContain('return rows[0] ?? null;');
  });
});
