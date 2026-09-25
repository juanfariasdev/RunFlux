import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CompilationFolders } from '../compilation-folders.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function folders() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runflux-folders-'));
  roots.push(root);
  return { root, folders: new CompilationFolders(() => root, ['local', 'aws']) };
}

it('moves a filled staging folder into place', async () => {
  const { root, folders: store } = folders();
  const folder = await store.write('Api-local-1-0000abcd', async (staging) => {
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'Api-local.zip'), 'zip');
  });
  expect(folder).toBe(path.join(root, 'Api-local-1-0000abcd'));
  expect(fs.readdirSync(root)).toEqual(['Api-local-1-0000abcd']);
  expect(await store.findArchive('Api-local.zip')).toBe(path.join(folder, 'Api-local.zip'));
});

it('leaves neither a staging nor a compilation folder when filling fails', async () => {
  const { root, folders: store } = folders();
  await expect(store.write('Api-local-2-0000abcd', async (staging) => {
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'half-written'), '');
    throw new Error('build failed');
  })).rejects.toThrow('build failed');
  expect(fs.readdirSync(root)).toEqual([]);
});
