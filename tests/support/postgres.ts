import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

/**
 * A real PostgreSQL, PGlite compiled to WebAssembly, served over TCP with the PostgreSQL wire
 * protocol: backends reach it through their own `pg` driver and a connection string, exactly as
 * they reach a database server. Each instance is an empty in-memory database.
 */
export class TestPostgres {
  readonly url: string;
  private readonly db: PGlite;
  private readonly server: PGLiteSocketServer;

  private constructor(db: PGlite, server: PGLiteSocketServer) {
    this.db = db;
    this.server = server;
    this.url = `postgres://postgres:postgres@${server.getServerConn()}/postgres`;
  }

  static async start(): Promise<TestPostgres> {
    const db = await PGlite.create();
    const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 32 });
    await server.start();
    return new TestPostgres(db, server);
  }

  async rows<TRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<TRow[]> {
    return (await this.db.query<TRow>(sql, params)).rows;
  }

  exec(sql: string): Promise<unknown> {
    return this.db.exec(sql);
  }

  async stop(): Promise<void> {
    await this.server.stop();
    await this.db.close();
  }
}
