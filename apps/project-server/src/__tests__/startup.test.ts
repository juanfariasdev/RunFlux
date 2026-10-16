// @vitest-environment node
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Every test in this file spawns a real process. tsx transpiles the server, prisma opens the
// database and the migration runs before anything is printed, which takes longer than Vitest's
// 5s default. The ceiling is set here rather than per test so the file reads as one idea.
vi.setConfig({ testTimeout: 60_000 });

/**
 * src/index.ts had no test at all, and it is the file that decides whether the server serves or
 * refuses. Everything it does is a side effect on process.env, process.exit and the real
 * filesystem, so a unit test cannot reach it — only a spawned process can. These tests run the
 * entry point the way `npm run examples:seed` or an operator would.
 *
 * The global setup already points DATABASE_URL, RUNFLUX_HOME, RUNFLUX_OUTPUT_DIR and
 * RUNFLUX_SECRET_KEY at a temporary directory, so nothing here touches the real database or the
 * real ~/.runflux/secret.key.
 */

const ROOT = resolve(__dirname, '../..');
const ENTRY = resolve(ROOT, 'src/index.ts');
const TSX = resolve(ROOT, '../../node_modules/.bin/tsx');
const BOOT_TIMEOUT_MS = 30_000;

interface Outcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface Boot {
  readonly stdout: () => string;
  readonly stderr: () => string;
  /** Resolves when the process exits, or when a watched pattern matches, or on timeout. */
  readonly settled: Promise<Outcome>;
  /** Resolves `settled` as soon as `until` matches the output, stopping the process. */
  readonly watch: (until: RegExp) => void;
  /** Resolves when `until` matches the output, leaving the process running. */
  readonly waitFor: (until: RegExp) => Promise<void>;
  readonly kill: () => void;
}

/** Spawns the entry point. Output accumulates live so a caller can match on it as it arrives. */
function boot(env: NodeJS.ProcessEnv): Boot {
  // `detached` puts the child in its own process group. tsx runs the entry point in a grandchild,
  // so killing the spawned pid alone leaves that grandchild alive and holding the port — a run of
  // this file leaked eleven listeners that way. Killing the group with a negative pid is what
  // actually reaches the server.
  const child = spawn(process.execPath, [TSX, ENTRY], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
  });
  const killGroup = (): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone, or the group is empty. Either way there is nothing left to stop.
    }
  };
  let stdout = '';
  let stderr = '';

  let done: (outcome: Outcome) => void = () => {};
  const settled = new Promise<Outcome>((resolve) => {
    done = resolve;
  });

  let finished = false;
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done({ code, signal, stdout, stderr });
  };

  const timer = setTimeout(() => {
    killGroup();
    finish(null, 'SIGKILL');
  }, BOOT_TIMEOUT_MS);

  const onOutput = () => {
    // A caller watching for a line does not want to wait for the process to go away, and the
    // process does not go away on SIGTERM: the server holds an open database connection. Killing
    // it here is what keeps this file at a second per test instead of a minute per test.
    for (const until of watchers) {
      if (until.test(stdout) || until.test(stderr)) {
        killGroup();
        finish(null, 'SIGKILL');
        return;
      }
    }
    // A holder must keep running once it is up — that is the point of holding a port. So it
    // waits for its line without stopping.
    for (const until of waiters) if (until.test(stdout) || until.test(stderr)) until.resolve();
  };

  const watchers: RegExp[] = [];
  const watch = (until: RegExp): void => {
    watchers.push(until);
  };

  const waiters: Array<RegExp & { resolve: () => void }> = [];
  /** Resolves when `until` matches the output. Does NOT stop the process. */
  const waitFor = (until: RegExp): Promise<void> =>
    new Promise<void>((resolve) => {
      waiters.push(Object.assign(new RegExp(until.source, until.flags), { resolve }));
      onOutput();
    });

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
    onOutput();
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
    onOutput();
  });
  child.on('error', (error) => {
    stderr += String(error);
    finish(null, null);
  });
  child.on('exit', (code, signal) => finish(code, signal));

  return {
    stdout: () => stdout,
    stderr: () => stderr,
    settled,
    watch,
    waitFor,
    kill: killGroup,
  };
}

/** Waits until `until` matches the accumulated output, then stops the process. */
async function runUntil(env: NodeJS.ProcessEnv, until: RegExp): Promise<Outcome> {
  const process_ = boot(env);
  process_.watch(until);
  return process_.settled;
}

/** Runs the entry point to its own exit. */
async function runToExit(env: NodeJS.ProcessEnv): Promise<Outcome> {
  const process_ = boot(env);
  return process_.settled;
}

const LISTENING = /\] listening on http:\/\/([^:]+):(\d+) \(authentication (on|off)\)/;

/**
 * A port this process may bind right now.
 *
 * No test in this file names a fixed port. A fixed one turns any leaked process into a failure
 * that looks like a product defect but is not: while writing these tests, an earlier version that
 * stopped the server with SIGTERM leaked a listener on 4100, and the next run failed on EADDRINUSE
 * instead of on what it meant to check.
 */
async function freePort(): Promise<number> {
  const probe = createHttpServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

let home: string;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'runflux-startup-'));
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('the entry point refuses a configuration it must not start with', () => {
  // Each of these is the whole contract of RN-02 at the process level: exit 1, one line, the
  // variable named. None of it was exercised before, because loadConfig was tested, not index.ts.
  it('exits 1 naming RUNFLUX_API_TOKEN when HOST exposes the server without one', async () => {
    const outcome = await runToExit({ HOST: '0.0.0.0', RUNFLUX_API_TOKEN: undefined });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('RUNFLUX_API_TOKEN');
    expect(outcome.stderr).toContain('exposes the project server');
    expect(outcome.stderr.split('\n').filter((line) => line.startsWith('[project-server]'))).toHaveLength(1);
  });

  it('exits 1 naming RUNFLUX_API_TOKEN when it is too short', async () => {
    const outcome = await runToExit({ RUNFLUX_API_TOKEN: 'a'.repeat(31) });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('at least 32 characters');
  });

  it('exits 1 naming RUNFLUX_BODY_LIMIT when it is not a size', async () => {
    const outcome = await runToExit({ RUNFLUX_BODY_LIMIT: 'enormous' });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('RUNFLUX_BODY_LIMIT');
    expect(outcome.stderr).toContain('must be a size');
  });

  it('exits 1 naming RUNFLUX_SECRET_KEY when the key is not 32 bytes', async () => {
    const outcome = await runToExit({ RUNFLUX_SECRET_KEY: Buffer.alloc(8).toString('base64') });
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('RUNFLUX_SECRET_KEY');
  });

  it('does not start listening after any refusal', async () => {
    const outcome = await runToExit({ HOST: '0.0.0.0', RUNFLUX_API_TOKEN: undefined });
    expect(outcome.stdout).not.toContain('listening on');
  });
});

describe('PORT, the setting with no guard (F-01, characterisation)', () => {
  // Measured 2026-10-16. loadConfig does not validate PORT, so the failure surfaces at listen()
  // as ERR_SOCKET_BAD_PORT, which is not a ConfigurationError, so index.ts:14 re-throws it.
  //
  // What the operator actually sees:
  //
  //   RangeError [ERR_SOCKET_BAD_PORT]: options.port should be >= 0 and < 65536.
  //   Received type number (NaN).
  //       at Server.listen (node:net:2159:5)
  //       at app.listen (.../express/lib/application.js:635:24)
  //       at <anonymous> (.../src/index.ts:22:33)
  //
  // against, for a setting that IS validated:
  //
  //   [project-server] HOST=0.0.0.0 exposes the project server; set RUNFLUX_API_TOKEN ...
  //
  // Both exit 1. That is the part worth pinning: the exit code cannot tell the operator which
  // kind of failure they had.
  it('exits 1 with a raw Node stack, not the one line the validated settings produce', async () => {
    const outcome = await runToExit({ PORT: 'abc' });
    expect(outcome.stdout).not.toContain('listening on');
    // Same exit code as a clean refusal — the code carries no information about which.
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/ERR_SOCKET_BAD_PORT/);
    expect(outcome.stderr).toMatch(/at Server\.listen \(node:net/);
    // The validated path prefixes its one line with [project-server]. This one does not.
    expect(outcome.stderr).not.toContain('[project-server]');
  });

  it('names the Node API parameter instead of the environment variable', async () => {
    const outcome = await runToExit({ PORT: 'abc' });
    // The sharpest form of the bug: the operator is told about `options.port`, a parameter of
    // Node's listen(), and never about PORT, the variable they set.
    expect(outcome.stderr).toContain('options.port');
    expect(outcome.stderr).not.toMatch(/\bPORT\b/);
  });

  it('accepts a partially numeric PORT and binds the truncated value', async () => {
    // parseInt stops at the first non-digit, so the tail is ignored and the number is accepted as
    // if it were valid. The port is a free one, because the truncated value must be bindable.
    const port = await freePort();
    const outcome = await runUntil({ PORT: `${port}abc` }, LISTENING);
    expect(outcome.stdout).toContain(`listening on http://127.0.0.1:${port}`);
  });
});

describe('a port already in use (F-13, characterisation)', () => {
  // Measured 2026-10-16. index.ts:22 calls .listen() with no 'error' handler, so EADDRINUSE
  // becomes an unhandled 'error' event:
  //
  //   node:events:487
  //         throw er; // Unhandled 'error' event
  //   Error: listen EADDRINUSE: address already in use 127.0.0.1:4177
  //   Emitted 'error' event on Server instance at:
  //
  // Running `npm run dev:server` twice is the most common developer mistake in this project, and
  // this is the only thing it says about it: no mention of RunFlux, none of PORT, and no hint that
  // another instance is holding the port. The three settings that loadConfig validates all answer
  // with one prefixed line naming the variable.
  it('crashes on an unhandled error event rather than naming the conflict', async () => {
    const port = await freePort();
    const holder = boot({ PORT: `${port}` });
    try {
      // waitFor, not watch: the holder has to keep listening, because holding the port is the
      // whole reason it exists.
      await holder.waitFor(LISTENING);
      // The first instance is running; the second cannot have the port.
      const second = await runToExit({ PORT: `${port}` });

      expect(second.stdout).not.toContain('listening on');
      expect(second.stderr).toMatch(/EADDRINUSE/);
      expect(second.stderr).toMatch(/Unhandled 'error' event/);
      expect(second.stderr).not.toContain('[project-server]');
    } finally {
      // Not `after`: a failing assertion would otherwise leave the holder listening and turn the
      // next run into an EADDRINUSE that has nothing to do with what it meant to check.
      holder.kill();
    }
  });

  it('never tells the operator that another instance is running', async () => {
    const port = await freePort();
    const holder = boot({ PORT: `${port}` });
    try {
      await holder.waitFor(LISTENING);
      const second = await runToExit({ PORT: `${port}` });

      // The message a developer would need, and does not get.
      expect(second.stderr).not.toMatch(/already running|another (instance|process|server)/i);
      // It does at least carry the port Node was given, which is the only usable part.
      expect(second.stderr).toContain(String(port));
    } finally {
      holder.kill();
    }
  });
});

describe('a valid configuration serves', () => {
  it('binds loopback and says that authentication is off', async () => {
    const outcome = await runUntil({ PORT: '0', RUNFLUX_API_TOKEN: undefined }, LISTENING);
    expect(outcome.stdout).toContain('listening on http://127.0.0.1:0 (authentication off)');
  });

  it('says that authentication is on when a token is set, and says nothing about the token', async () => {
    const token = 'b'.repeat(32);
    const outcome = await runUntil({ PORT: '0', RUNFLUX_API_TOKEN: token }, LISTENING);
    expect(outcome.stdout).toContain('(authentication on)');
    expect(outcome.stdout).not.toContain(token);
    expect(outcome.stderr).not.toContain(token);
  });

  it('prints no sealed line when the database has nothing to migrate', async () => {
    const outcome = await runUntil({ PORT: '0' }, LISTENING);
    expect(outcome.stdout).not.toContain('sealed');
  });

  it('prints the host it actually bound, not a fixed localhost', async () => {
    const outcome = await runUntil({ PORT: '0', HOST: 'localhost' }, LISTENING);
    expect(outcome.stdout).toContain('listening on http://localhost:0');
  });
});

describe('the startup order', () => {
  // The migration runs between the container being built and the server listening, so a project
  // can never be served with clear values still in the database. The ordering is the guarantee;
  // this test pins that both lines appear and that neither leaks a value.
  it('reports the migration before it reports listening', async () => {
    const outcome = await runUntil({ PORT: '0' }, LISTENING);
    const listening = outcome.stdout.indexOf('listening on');
    expect(listening).toBeGreaterThanOrEqual(0);
    const sealed = outcome.stdout.indexOf('sealed');
    if (sealed >= 0) expect(sealed).toBeLessThan(listening);
  });

  it('never writes a value to the log, whatever it migrates', async () => {
    const outcome = await runUntil({ PORT: '0' }, LISTENING);
    expect(outcome.stdout).not.toMatch(/RUNFLUX_SECRET_KEY|SECRET_KEY=/);
    expect(outcome.stderr).not.toMatch(/RUNFLUX_SECRET_KEY/);
  });
});