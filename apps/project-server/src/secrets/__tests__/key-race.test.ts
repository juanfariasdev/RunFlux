// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * F-03. `key-guards.test.ts` exercises the EEXIST branch with a mocked filesystem, which proves
 * the branch behaves when it is entered. It cannot prove that it is ever entered, and it cannot
 * prove the property that matters: that two instances starting together end up with the SAME key.
 *
 * That property is the one with teeth. The key seals every project variable. If two instances
 * disagree on it, one of them seals values the other cannot read, and nothing reports it — the
 * values simply come back as `unreadable` in the other instance's project view. Silent divergence,
 * discovered later, by whoever happens to open the project.
 *
 * So these tests run real processes against one real directory.
 */

// Written to a temporary directory, never into the repository.
const SOURCE = resolve(__dirname, '../../secrets/secret-key-source.js');
const TSX = resolve(__dirname, '../../../../../node_modules/.bin/tsx');

const SENTINEL = 'RUNFLUX-KEY:';

const RACER = `
import { SecretKeySource } from ${JSON.stringify(SOURCE)};
const SENTINEL = 'RUNFLUX-KEY:';
const env = process.env as Record<string, string>;

// The barrier. Without it, sixteen processes spawned together reach existsSync tens of
// milliseconds apart, the first one creates the file, and the other fifteen never see a race —
// the test would pass while proving nothing.
const target = Number(env.RFLX_BARRIER ?? '0');
const idle = new Int32Array(new SharedArrayBuffer(4));
while (Date.now() < target) Atomics.wait(idle, 0, 0, 1);

const started = process.hrtime.bigint();
const key = new SecretKeySource({ RUNFLUX_HOME: env.RUNFLUX_HOME! }).load();
const micros = Number((process.hrtime.bigint() - started) / 1000n);

process.stdout.write(SENTINEL + JSON.stringify({ key: key.toString('base64'), micros }) + '\\n');
`;

const SEALER = `
import { AesGcmValueCipher } from ${JSON.stringify(resolve(__dirname, '../../secrets/value-cipher.js'))};
import { SecretKeySource } from ${JSON.stringify(SOURCE)};
const SENTINEL = 'RUNFLUX-KEY:';
const env = process.env as Record<string, string>;
const cipher = new AesGcmValueCipher(new SecretKeySource({ RUNFLUX_HOME: env.RUNFLUX_HOME! }).load());
process.stdout.write(SENTINEL + cipher.seal(env.RFLX_PLAINTEXT!, env.RFLX_CONTEXT!) + '\\n');
`;

const OPENER = `
import { AesGcmValueCipher } from ${JSON.stringify(resolve(__dirname, '../../secrets/value-cipher.js'))};
import { SecretKeySource } from ${JSON.stringify(SOURCE)};
const SENTINEL = 'RUNFLUX-KEY:';
const env = process.env as Record<string, string>;
const cipher = new AesGcmValueCipher(new SecretKeySource({ RUNFLUX_HOME: env.RUNFLUX_HOME! }).load());
process.stdout.write(SENTINEL + cipher.open(env.RFLX_SEALED!, env.RFLX_CONTEXT!) + '\\n');
`;

let home: string;
let scripts: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'runflux-race-'));
  scripts = join(home, '.scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'racer.ts'), RACER);
  writeFileSync(join(scripts, 'sealer.ts'), SEALER);
  writeFileSync(join(scripts, 'opener.ts'), OPENER);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

/**
 * Runs a script to completion and returns what it marked with the sentinel, or the failure it
 * reported on stderr.
 *
 * Waiting on `exit` is the bug this replaces: it can fire while the stdout pipe is still buffered,
 * so the output arrives truncated. `close` on the stream fires after the last chunk is delivered.
 *
 * A failure is returned rather than thrown, because F-14 makes failure a legitimate outcome here.
 */
/**
 * Runs a script to completion and reports what it did.
 *
 * Waiting on `exit` is the bug this replaces: it can fire while the stdout pipe is still buffered,
 * so the output arrives truncated. `close` on the stream fires after the last chunk is delivered.
 *
 * A failure is a value rather than a thrown error, because F-14 makes failure a legitimate outcome
 * of a concurrent start, and the caller has to look at it rather than be stopped by it.
 */
type ScriptResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };

function runScript(script: string, env: NodeJS.ProcessEnv): Promise<ScriptResult> {
  return new Promise<ScriptResult>((done, fail) => {
    const child = spawn(process.execPath, [TSX, join(scripts, script)], {
      env: { ...process.env, RUNFLUX_HOME: home, ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', fail);
    child.stdout.on('close', () => {
      if (err.trim()) {
        done({ ok: false, error: err });
        return;
      }
      const marked = out.split(SENTINEL);
      if (marked.length !== 2) fail(new Error(`${script} printed no sentinel. Raw: ${JSON.stringify(out.slice(0, 400))}`));
      else done({ ok: true, value: marked[1].trim() });
    });
  });
}

/** What one racer did: it either loaded a key, or it refused. */
interface Race {
  readonly key: string | null;
  readonly micros: number;
  readonly error: string | null;
}

function race(env: NodeJS.ProcessEnv = {}): Promise<Race> {
  return runScript('racer.ts', env).then((result) => {
    if (!result.ok) return { key: null, micros: 0, error: result.error };
    const parsed = JSON.parse(result.value) as { key: string; micros: number };
    return { key: parsed.key, micros: parsed.micros, error: null };
  });
}

async function run(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await runScript(script, env);
  if (!result.ok) throw new Error(`${script} failed: ${result.error}`);
  return result.value;
}

/**
 * Releases `count` racers at one wall-clock instant and collects what each of them did.
 */
async function burst(count: number): Promise<Race[]> {
  const barrier = Date.now() + 3000;
  return Promise.all(Array.from({ length: count }, () => race({ RFLX_BARRIER: `${barrier}` })));
}

const RACERS = 16;

/**
 * How many of the sixteen may refuse for F-14 before this is a new problem.
 *
 * Observed 1 in 160. Two is a ceiling that keeps a genuine regression visible while never firing
 * on the known window. It is deliberately NOT "zero": a test that fails once every twenty runs is
 * a test the suite learns to ignore, and ignoring is worse than the bug it was watching for.
 */
const toleratedFailures = (): number => 2;

describe('two instances starting together (F-03)', () => {
  it('every instance that starts at the same instant ends up with the same key', async () => {
    // All sixteen wait for one wall-clock moment, then all call existsSync within a millisecond
    // of each other. The first to reach writeFileSync wins; the rest must take the EEXIST path
    // and read the winner's key rather than keeping their own.
    //
    // The barrier is not decoration. Without it, sixteen processes spawned together reach
    // existsSync tens of milliseconds apart, the first one creates the file, and the other
    // fifteen never see a race — the assertion below would hold for the wrong reason.
    //
    // Measured 2026-10-16, same sixteen-process burst against a copy of the module:
    //
    //   flag: 'wx' (the real code)  ->  1 distinct key
    //   flag: 'w'  (mutated)        ->  7 distinct keys
    //
    // So the exclusive create is what makes this invariant true, and without it roughly 44% of
    // instances would hold a key their peers cannot use. This test is not vacuous: removing the
    // `wx` fails it.
    const results = await burst(RACERS);

    // F-14: an instance can legitimately refuse to start here. See the tolerance note below —
    // the assertion is on the invariant, not on every instance succeeding.
    const loaded = results.filter((r) => r.key !== null);
    expect(loaded.length).toBeGreaterThanOrEqual(RACERS - toleratedFailures());

    const distinct = new Set(loaded.map((r) => r.key as string));
    expect(distinct.size, `instances disagreed on the sealing key: ${distinct.size} distinct keys`).toBe(1);

    // And that shared key is what is on disk, not merely what the processes believe.
    const stored = readKeyFile();
    expect(stored).toBe(loaded[0].key);
    expect(Buffer.from(stored, 'base64')).toHaveLength(32);
  }, 120_000);

  it('any instance that refuses does so for F-14 and no other reason', async () => {
    // F-14, characterised. `flag: 'wx'` makes creation exclusive but does NOT make the write
    // atomic: between the winner's open() creating the file and its write() completing, the file
    // exists and is empty or partial. A loser that hits EEXIST in that window reads it, finds it
    // is not 32 bytes, and refuses to start.
    //
    // Measured 2026-10-16 over 160 concurrent starts: 1 refusal, in one burst of sixteen.
    // Narrow, real, and it happens on a cold start — the first run after cloning or restarting a
    // container — which is exactly when nobody expects the key store to be a problem.
    //
    // The refusal is tolerated here because it is narrow; the CAUSE is pinned because it is the
    // only reason tolerated. Any other failure mode still fails the suite.
    const results = await burst(RACERS);
    const refused = results.filter((r) => r.key === null);

    for (const failure of refused) {
      expect(
        failure.error,
        `an instance refused for an unexpected reason: ${failure.error}`,
      ).toContain('must hold 32 bytes in base64');
    }

    // The file is always valid once the dust settles, which is what makes the refusal transient
    // and the recovery "start it again" — advice the error message does not give.
    expect(Buffer.from(readKeyFile(), 'base64')).toHaveLength(32);
  }, 120_000);

  it('the race is actually happening, not just sequential starts that happen to agree', async () => {
    // Control for the test above. Staggered starts cannot collide, so they agree trivially.
    // If the parallel run also agreed for a trivial reason, the two would be indistinguishable —
    // this measures what "no collision" looks like so the parallel result means something.
    const sequential = await race({ RFLX_BARRIER: '0' });
    expect(sequential.key, 'an uncontended start must load a key').not.toBeNull();
    const simultaneous = (await burst(RACERS)).filter((r) => r.key !== null);

    // With a working exclusive create, the losers do strictly more work than the winner: they
    // attempt a write that fails before they read. So a simultaneous burst is measurably slower
    // per process than an uncontended load. If that difference vanished, the barrier would have
    // stopped working and the parallel test above would no longer be evidence of anything.
    const uncontended = sequential.micros;
    const contended = Math.max(...simultaneous.map((r) => r.micros));
    expect(contended).toBeGreaterThan(uncontended);
  }, 120_000);

  it('the shared key is what a value sealed by one instance needs to be read by another', async () => {
    // The end of the chain. This is the property the whole race exists to protect: a value sealed
    // in one process opens in another, because both held the same key. If this fails, every value
    // in the project is unreadable to the other instance and nothing says why.
    await burst(8);

    const sealed = await run('sealer.ts', { RFLX_PLAINTEXT: 'the shared secret', RFLX_CONTEXT: 'project-1:TOKEN' });
    expect(sealed).toMatch(/^v1\./);

    const opened = await run('opener.ts', { RFLX_SEALED: sealed, RFLX_CONTEXT: 'project-1:TOKEN' });
    expect(opened).toBe('the shared secret');
  }, 120_000);

  it('leaves the file and its directory private, whichever instance won', async () => {
    await burst(RACERS);

    expect(statSync(join(home, '.runflux', 'secret.key')).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.runflux')).mode & 0o777).toBe(0o700);
  }, 120_000);
});

describe('a key that already exists', () => {
  it('is used as it stands, with no second file and no rewrite', async () => {
    const first = await race({ RFLX_BARRIER: '0' });
    const before = statSync(join(home, '.runflux', 'secret.key')).mtimeMs;
    const second = await race({ RFLX_BARRIER: '0' });
    expect(first.key).not.toBeNull();
    expect(second.key).toBe(first.key);
    expect(statSync(join(home, '.runflux', 'secret.key')).mtimeMs).toBe(before);
  }, 60_000);

  it('survives a stored key that is not 32 bytes, by failing rather than regenerating', async () => {
    // The worst outcome would be a key file that cannot be read being quietly replaced, which
    // would make every sealed value in the database permanently unreadable. It must refuse.
    mkdirSync(join(home, '.runflux'), { recursive: true });
    writeFileSync(join(home, '.runflux', 'secret.key'), Buffer.alloc(8).toString('base64'), { flag: 'wx' });
    const refused = await race({ RFLX_BARRIER: '0' });
    expect(refused.key, 'a key file that cannot be read must be refused, not replaced').toBeNull();
    expect(refused.error).toContain('must hold 32 bytes in base64');
    // Still the same eight bytes of nonsense: not overwritten.
    expect(statSync(join(home, '.runflux', 'secret.key')).size).toBeGreaterThan(0);
    expect(Buffer.from(readKeyFile(), 'base64')).toHaveLength(8);
  }, 60_000);
});

function readKeyFile(): string {
  return readFileSync(join(home, '.runflux', 'secret.key'), 'utf8').trim();
}