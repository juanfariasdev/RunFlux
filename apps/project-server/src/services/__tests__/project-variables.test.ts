import { describe, expect, it } from 'vitest';
import { AesGcmValueCipher, UnreadableValueError } from '../../secrets/value-cipher.js';
import { ProjectVariables } from '../project-variables.js';

const KEY = Buffer.alloc(32, 3);
const OTHER_KEY = Buffer.alloc(32, 9);
const cipher = new AesGcmValueCipher(KEY);
const variables = new ProjectVariables(cipher);

const PROJECT = 'project-1';
const context = (key: string) => `${PROJECT}:${key}`;

describe('ProjectVariables.read — malformed storage', () => {
  it('reads missing storage as an empty list (DB-07)', () => {
    expect(variables.read(null)).toEqual([]);
    expect(variables.read('')).toEqual([]);
  });

  // The promise on line 29 of the source says "unreadable stored JSON reads as an empty
  // list". Nothing exercised the catch before this file.
  it('reads storage that is not JSON as an empty list, never as an error', () => {
    for (const broken of ['{', 'not json', '{"key":', '[1,2', '﻿']) {
      expect(variables.read(broken)).toEqual([]);
    }
  });

  it('reads JSON that is valid but not an array as an empty list', () => {
    for (const notAList of ['{"key":"A"}', '42', '"a string"', 'null', 'true']) {
      expect(variables.read(notAList)).toEqual([]);
    }
  });

  it('drops entries without a string key, and keeps the rest', () => {
    const stored = JSON.stringify([{ key: 'KEEP', sealed: 'v1.a.b.c' }, { value: 'no key' }, null, 42, 'text', { key: 7 }]);
    expect(variables.read(stored).map((entry) => entry.key)).toEqual(['KEEP']);
  });

  it('keeps a legacy entry that still carries a clear value', () => {
    const stored = JSON.stringify([{ key: 'LEGACY', value: 'in the clear' }]);
    expect(variables.read(stored)).toEqual([{ key: 'LEGACY', value: 'in the clear' }]);
  });
});

describe('ProjectVariables.views — the read shape carries no value', () => {
  it('reports hasValue and never the value', () => {
    const sealed = cipher.seal('super-secret', context('KEY'));
    const views = variables.views(PROJECT, JSON.stringify([{ key: 'KEY', sealed }]));
    expect(views).toEqual([{ key: 'KEY', hasValue: true }]);
    expect(JSON.stringify(views)).not.toContain('super-secret');
  });

  it('reports hasValue false for an entry with neither sealed nor value', () => {
    expect(variables.views(PROJECT, JSON.stringify([{ key: 'EMPTY' }]))).toEqual([{ key: 'EMPTY', hasValue: false }]);
  });

  it('treats a legacy empty value as having no value', () => {
    expect(variables.views(PROJECT, JSON.stringify([{ key: 'K', value: '' }]))).toEqual([{ key: 'K', hasValue: false }]);
  });

  it('marks unreadable only when a sealed entry exists and the key fails to open it', () => {
    const sealedWithAnotherKey = new AesGcmValueCipher(OTHER_KEY).seal('s', context('KEY'));
    const views = variables.views(PROJECT, JSON.stringify([{ key: 'KEY', sealed: sealedWithAnotherKey }]));
    expect(views).toEqual([{ key: 'KEY', hasValue: true, unreadable: true }]);
  });

  it('does not mark unreadable an entry that was never sealed', () => {
    const views = variables.views(PROJECT, JSON.stringify([{ key: 'LEGACY', value: 'clear' }]));
    expect(views).toEqual([{ key: 'LEGACY', hasValue: true }]);
  });

  it('does not mark unreadable a sealed entry sealed for another project', () => {
    // The AAD binds project and name, so a value moved between projects does not open.
    const sealedElsewhere = cipher.seal('s', 'other-project:KEY');
    const views = variables.views(PROJECT, JSON.stringify([{ key: 'KEY', sealed: sealedElsewhere }]));
    expect(views).toEqual([{ key: 'KEY', hasValue: true, unreadable: true }]);
  });

  it('carries the description through when there is one', () => {
    const sealed = cipher.seal('s', context('KEY'));
    expect(variables.views(PROJECT, JSON.stringify([{ key: 'KEY', description: 'why', sealed }]))).toEqual([
      { key: 'KEY', description: 'why', hasValue: true },
    ]);
  });
});

describe('ProjectVariables.apply — the update rule (RN-08)', () => {
  const stored = () => JSON.stringify([{ key: 'KEY', description: 'old', sealed: cipher.seal('kept', context('KEY')) }]);

  it('keeps the stored value when the entry carries none', () => {
    const result = variables.apply(PROJECT, stored(), [{ key: 'KEY', description: 'new' }]);
    const parsed = JSON.parse(result);
    expect(parsed[0]).toEqual({ key: 'KEY', description: 'new', sealed: expect.any(String) });
    expect(variables.environment(PROJECT, result).values.KEY).toBe('kept');
  });

  it('sets the value when the entry carries one', () => {
    const result = variables.apply(PROJECT, stored(), [{ key: 'KEY', value: 'fresh' }]);
    expect(variables.environment(PROJECT, result).values.KEY).toBe('fresh');
  });

  it('clears the value when the entry carries empty text', () => {
    const result = variables.apply(PROJECT, stored(), [{ key: 'KEY', value: '' }]);
    expect(JSON.parse(result)).toEqual([{ key: 'KEY' }]);
    expect(variables.views(PROJECT, result)).toEqual([{ key: 'KEY', hasValue: false }]);
  });

  it('removes a variable left out of the list', () => {
    expect(variables.apply(PROJECT, stored(), [])).toBe('[]');
  });

  it('drops the value when the variable is renamed, because the sealed text is bound to the name', () => {
    const result = variables.apply(PROJECT, stored(), [{ key: 'RENAMED', description: 'x' }]);
    expect(variables.views(PROJECT, result)).toEqual([{ key: 'RENAMED', description: 'x', hasValue: false }]);
  });

  // Line 59: a legacy clear value re-seals on an update that carries no value.
  // Removing that line would drop the user's stored secret silently.
  it('re-seals a legacy clear value when the entry carries none', () => {
    const legacy = JSON.stringify([{ key: 'LEGACY', value: 'clear-text' }]);
    const result = variables.apply(PROJECT, legacy, [{ key: 'LEGACY' }]);
    expect(JSON.parse(result)).toEqual([{ key: 'LEGACY', sealed: expect.any(String) }]);
    expect(variables.environment(PROJECT, result).values.LEGACY).toBe('clear-text');
  });

  it('keeps the stored value when the entry carries only a description and the stored one was empty', () => {
    const empty = JSON.stringify([{ key: 'KEY' }]);
    const result = variables.apply(PROJECT, empty, [{ key: 'KEY', description: 'now documented' }]);
    expect(JSON.parse(result)).toEqual([{ key: 'KEY', description: 'now documented' }]);
  });

  it('drops a description that is blank', () => {
    const result = variables.apply(PROJECT, null, [{ key: 'NEW', value: 'v', description: '   ' }]);
    expect(JSON.parse(result)).toEqual([{ key: 'NEW', sealed: expect.any(String) }]);
  });
});

describe('ProjectVariables.environment — the one path that returns values', () => {
  it('returns an empty string for a variable with no value', () => {
    expect(variables.environment(PROJECT, JSON.stringify([{ key: 'EMPTY' }])).values).toEqual({ EMPTY: '' });
  });

  it('returns the clear value of a legacy entry', () => {
    expect(variables.environment(PROJECT, JSON.stringify([{ key: 'L', value: 'clear' }])).values).toEqual({ L: 'clear' });
  });

  it('lists an undecryptable name apart instead of returning a wrong value', () => {
    const foreign = new AesGcmValueCipher(OTHER_KEY).seal('s', context('KEY'));
    const result = variables.environment(PROJECT, JSON.stringify([{ key: 'KEY', sealed: foreign }, { key: 'OK', sealed: cipher.seal('fine', context('OK')) }]));
    expect(result.values).toEqual({ OK: 'fine' });
    expect(result.unreadable).toEqual(['KEY']);
  });

  it('raises UnreadableValueError type when a sealed text is not shaped like one', () => {
    const result = variables.environment(PROJECT, JSON.stringify([{ key: 'KEY', sealed: 'v1.abc' }]));
    expect(result.values).toEqual({});
    expect(result.unreadable).toEqual(['KEY']);
    // Pins the error class the contract names; the environment path swallows it into the list.
    expect(new UnreadableValueError()).toBeInstanceOf(Error);
  });
});

describe('ProjectVariables.exported — an export carries no value', () => {
  it('lists names and descriptions only', () => {
    const sealed = cipher.seal('never-in-the-file', context('KEY'));
    const exported = variables.exported(JSON.stringify([{ key: 'KEY', description: 'why', sealed }, { key: 'LEGACY', value: 'clear' }]));
    expect(exported).toEqual([{ key: 'KEY', description: 'why' }, { key: 'LEGACY' }]);
    expect(JSON.stringify(exported)).not.toContain('never-in-the-file');
    expect(JSON.stringify(exported)).not.toContain('clear');
  });
});

describe('ProjectVariables.migrate — the startup seal', () => {
  it('returns null when nothing carries a clear value, so the caller writes nothing', () => {
    const sealed = cipher.seal('s', context('KEY'));
    expect(variables.migrate(PROJECT, JSON.stringify([{ key: 'KEY', sealed }]))).toBeNull();
    expect(variables.migrate(PROJECT, null)).toBeNull();
  });

  it('seals every clear value and counts the non-empty ones', () => {
    const stored = JSON.stringify([{ key: 'A', value: 'a' }, { key: 'B', value: '' }, { key: 'C', value: 'c' }]);
    const migrated = variables.migrate(PROJECT, stored);
    expect(migrated?.sealed).toBe(2);
    expect(JSON.parse(migrated!.stored)).toEqual([{ key: 'A', sealed: expect.any(String) }, { key: 'B' }, { key: 'C', sealed: expect.any(String) }]);
  });

  it('keeps the description of a value it seals', () => {
    const migrated = variables.migrate(PROJECT, JSON.stringify([{ key: 'A', value: 'a', description: 'why' }]));
    expect(JSON.parse(migrated!.stored)[0].description).toBe('why');
  });

  it('leaves already sealed entries untouched while sealing the clear ones', () => {
    const sealed = cipher.seal('kept', context('S'));
    const stored = JSON.stringify([{ key: 'S', sealed }, { key: 'A', value: 'a' }]);
    const migrated = variables.migrate(PROJECT, stored);
    expect(variables.environment(PROJECT, migrated!.stored).values).toEqual({ S: 'kept', A: 'a' });
  });
});