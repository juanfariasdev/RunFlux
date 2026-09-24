import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildProfile } from '../project/build-profile.js';
import { EnvFile, EnvFileError } from '../project/env-file.js';
import { code, MarkdownDocument } from '../project/markdown.js';
import { packageManifest, TOOL_VERSIONS } from '../project/package-manifest.js';
import { toPackageName, toStackName } from '../project/package-name.js';
import { ProjectFiles } from '../project/project-files.js';
import { sortedRecord } from '../project/records.js';
import { TemplateDirectory } from '../project/template-directory.js';
import { toYaml } from '../project/yaml.js';
import { toAwsCron } from '../targets/aws-schedule.js';

describe('toYaml', () => {
  it('writes nested maps and lists in block style', () => {
    expect(toYaml({ services: { app: { build: '.', ports: ['${PORT:-3000}:3000'], depends_on: ['db'] } }, volumes: { data: {} } })).toBe([
      'services:', '  app:', '    build: .', '    ports:', '      - ${PORT:-3000}:3000', '    depends_on:', '      - db', 'volumes:', '  data: {}', '',
    ].join('\n'));
  });

  it('skips undefined entries and writes empty collections inline', () => {
    expect(toYaml({ kept: 1, skipped: undefined, list: [], map: {} })).toBe('kept: 1\nlist: []\nmap: {}\n');
  });

  it('writes lists of maps', () => {
    expect(toYaml({ items: [{ a: 1, b: 'x' }] })).toBe('items:\n  -\n    a: 1\n    b: x\n');
  });

  it.each([
    ['', '""'], ['true', '"true"'], ['no', '"no"'], ['42', '"42"'], ['1.5', '"1.5"'], ['22:22', '"22:22"'],
    ['- item', '"- item"'], ['key: value', '"key: value"'], ['# comment', '"# comment"'], ['trailing ', '"trailing "'], ['ends:', '"ends:"'],
    ['value #not-a-comment', '"value #not-a-comment"'], ['two\nlines', '"two\\nlines"'], ['tab\there', '"tab\\there"'],
  ])('quotes %j', (text, expected) => {
    expect(toYaml({ value: text })).toBe(`value: ${expected}\n`);
  });

  it.each(['plain', 'postgres:16-alpine', '${POSTGRES_USER:-postgres}', 'PORT=3000', 'unless-stopped'])('leaves %j unquoted', (text) => {
    expect(toYaml({ value: text })).toBe(`value: ${text}\n`);
  });

  it('writes scalars, null and booleans, quoting keys YAML would read as booleans', () => {
    expect(toYaml({ enabled: true, none: null, count: 3, yes: 'y' })).toBe('enabled: true\nnone: null\ncount: 3\n"yes": "y"\n');
  });
});

describe('EnvFile', () => {
  it.each([
    ['plain', 'plain'], ['', ''], ['postgres://user@host:5432/db', 'postgres://user@host:5432/db'],
    ['two words', "'two words'"], ['has#hash', "'has#hash'"], ['$HOME', "'$HOME'"], ['say "hi"', `'say "hi"'`],
    ["it's", `"it's"`], ['line\nbreak', '"line\\nbreak"'],
  ])('writes %j as %s', (value, written) => {
    expect(new EnvFile().variable('KEY', value).toString()).toBe(`KEY=${written}\n`);
  });

  it('keeps comments on their own lines and skips blank ones', () => {
    expect(new EnvFile().comment('First\n\n  Second=2  ').blank().variable('A').toString()).toBe('# First\n# Second=2\n\nA=\n');
  });

  it.each([['BAD-NAME', 'x', '"BAD-NAME" is not an environment variable name'], ['KEY', `it's\n"$`, 'The value of KEY mixes quotes']])('rejects %j = %j', (key, value, message) => {
    expect(() => new EnvFile().variable(key, value)).toThrow(EnvFileError);
    expect(() => new EnvFile().variable(key, value)).toThrow(message);
  });
});

describe('packageManifest', () => {
  it('describes an ES module on the vendored runtime with the shared tools, sorted as npm writes it', () => {
    const manifest = packageManifest({ name: 'app', scripts: { build: 'x' }, dependencies: { zod: '1', cors: '2' }, devDependencies: { vitest: '4' } });
    expect(manifest).toMatchObject({ name: 'app', version: '1.0.0', private: true, type: 'module', engines: { node: '>=22' }, scripts: { build: 'x' } });
    expect(Object.keys(manifest.dependencies)).toEqual(['@runflux/runtime', 'cors', 'zod']);
    expect(manifest.devDependencies).toEqual({ ...TOOL_VERSIONS, vitest: '4' });
  });
});

describe('MarkdownDocument', () => {
  it('separates blocks with a blank line and skips empty lists', () => {
    const markdown = new MarkdownDocument().heading(1, 'Title').paragraph(`Run ${code('npm start')}.`).list([]).list(['a', 'b']).code('bash', ['npm install']).toString();
    expect(markdown).toBe('# Title\n\nRun `npm start`.\n\n- a\n- b\n\n```bash\nnpm install\n```\n');
  });
});

describe('project naming', () => {
  it.each([["Customer's backend", 'customer-s-backend'], ['Ação Rápida!', 'acao-rapida'], ['---', 'fallback']])('derives the package name of %j', (name, expected) => {
    expect(toPackageName(name, 'fallback')).toBe(expected);
  });

  it('derives CloudFormation stack names', () => {
    expect(toStackName("Customer's backend")).toBe('CustomersbackendStack');
    expect(toStackName('!!!')).toBe('WorkflowStack');
    expect(toStackName('Ação Rápida')).toBe('AcaoRapidaStack');
    expect(toStackName('2024 orders')).toBe('Workflow2024ordersStack');
    const long = toStackName('x'.repeat(300));
    expect(long).toHaveLength(128);
    expect(long.endsWith('Stack')).toBe(true);
  });

  it('sorts dependency records', () => {
    expect(Object.keys(sortedRecord({ zod: '1', '@types/a': '1', express: '1' }))).toEqual(['@types/a', 'express', 'zod']);
  });
});

describe('ProjectFiles', () => {
  it('keeps insertion order, formats JSON and refuses duplicate paths', () => {
    const files = new ProjectFiles().text('a.txt', 'A', 'asset').json('b.json', { b: 1 });
    expect(files.list()).toEqual([{ path: 'a.txt', content: 'A', type: 'asset' }, { path: 'b.json', content: '{\n  "b": 1\n}\n', type: 'config' }]);
    expect(() => files.text('a.txt', 'again', 'asset')).toThrow('Duplicate generated file "a.txt"');
  });
});

describe('TemplateDirectory', () => {
  it('reads template sets recursively with their types, filtered by path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-templates-'));
    try {
      for (const [file, content] of [['one/src/a.ts', 'a'], ['one/lib/b.ts', 'b'], ['one/Dockerfile', 'd'], ['two/c.json', 'c']]) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), content);
      }
      const templates = new TemplateDirectory(root);
      expect(await templates.files(['one', 'two'])).toEqual([
        { path: 'Dockerfile', content: 'd', type: 'infrastructure' },
        { path: 'lib/b.ts', content: 'b', type: 'infrastructure' },
        { path: 'src/a.ts', content: 'a', type: 'source' },
        { path: 'c.json', content: 'c', type: 'config' },
      ]);
      expect((await templates.files(['one'], (file) => file !== 'Dockerfile')).map((file) => file.path)).toEqual(['lib/b.ts', 'src/a.ts']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('ships the real templates', async () => {
    const files = await new TemplateDirectory().files(['shared', 'local', 'aws']);
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining(['src/workflow.ts', 'src/server.ts', 'src/handler.ts', 'lib/workflow-stack.ts', 'Dockerfile']));
  });
});

describe('BuildProfile', () => {
  it('renders the build command of a server, splitting shared code and keeping dependencies external', () => {
    expect(BuildProfile.server(['src/server.ts', 'src/run.ts']).command()).toBe(
      'esbuild src/server.ts src/run.ts --bundle --format=esm --splitting --packages=external --alias:@runflux/runtime=./vendor/runflux-runtime --out-extension:.js=.mjs --platform=node --target=node22 --outdir=dist',
    );
  });

  it('renders the build command of a function, bundling dependencies with a require shim', () => {
    expect(BuildProfile.function(['src/handler.ts']).command()).toBe(
      'esbuild src/handler.ts --bundle --format=esm --alias:@runflux/runtime=./vendor/runflux-runtime --out-extension:.js=.mjs --platform=node --target=node22 '
      + `--banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" --outdir=dist`,
    );
  });

  it('round-trips through the build manifest', () => {
    const profile = BuildProfile.fromManifest({ build: { entryPoints: ['src/handler.ts'], bundleDependencies: true } });
    expect(profile.command()).toBe(BuildProfile.function(['src/handler.ts']).command());
  });
});

describe('toAwsCron', () => {
  it.each([
    ['*/15 * * * *', 'cron(*/15 * * * ? *)'],
    ['0 9 * * 1-5', 'cron(0 9 ? * 2-6 *)'],
    ['0 0 1 * *', 'cron(0 0 1 * ? *)'],
    ['30 6 * * 0,6', 'cron(30 6 ? * 1,7 *)'],
    ['0 */2 * * 1/2', 'cron(0 */2 ? * 2,4,6 *)'],
    ['0 0 * * */2', 'cron(0 0 ? * 1,3,5,7 *)'],
    ['0 0 * * */7', 'cron(0 0 ? * 1 *)'],
    ['0 0 * * 1-5/2', 'cron(0 0 ? * 2,4,6 *)'],
    ['0 12 * * MON', 'cron(0 12 ? * 2 *)'],
    ['0 12 * * MON-FRI', 'cron(0 12 ? * 2-6 *)'],
    ['0 0 * * 7', 'cron(0 0 ? * 1 *)'],
    ['0 0 * * 5-7', 'cron(0 0 ? * 1,6-7 *)'],
    ['0 0 * * 0,1,2,4', 'cron(0 0 ? * 1-3,5 *)'],
    ['0 0 1 JAN-MAR *', 'cron(0 0 1 JAN-MAR ? *)'],
    ['  0   0 * * *  ', 'cron(0 0 * * ? *)'],
  ])('translates %j', (expression, expected) => {
    expect(toAwsCron(expression)).toBe(expected);
  });

  it.each([
    ['0 0 * *', 'expected 5 fields'],
    ['0 0 0 * * *', 'expected 5 fields'],
    ['61 0 * * *', 'minute "61" is not a value from 0 to 59'],
    ['0 0 1 * 1', 'cannot combine day-of-month and day-of-week'],
  ])('rejects %j', (expression, message) => {
    expect(() => toAwsCron(expression)).toThrow(message);
  });
});
