import { validateManifest } from '@runflux/plugin-system/sdk';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import manual from '../runtime';

const clock = { now: () => new Date('2026-01-01T12:00:00.000Z') };

describe('trigger-manual-example', () => {
  it('declares a valid trigger manifest supported only locally', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.category).toBe('trigger');
    expect(manifest.supportedPlatforms).toEqual(['local']);
  });

  it('stamps the payload with its label and the current time', async () => {
    const record = await executeNode(manual, { parameters: { label: 'Import' }, input: { id: 42 }, services: { clock } });
    expect(record.output).toEqual({ id: 42, label: 'Import', triggeredAt: '2026-01-01T12:00:00.000Z' });
  });

  it.each([undefined, 'text', ['list']])('ignores a payload that is not an object (%j)', async (input) => {
    expect((await executeNode(manual, { input, services: { clock } })).output).toEqual({ label: 'Manual run', triggeredAt: '2026-01-01T12:00:00.000Z' });
  });

  it('lets the label override a payload field of the same name', async () => {
    expect((await executeNode(manual, { parameters: { label: 'Mine' }, input: { label: 'theirs' }, services: { clock } })).output).toMatchObject({ label: 'Mine' });
  });
});
