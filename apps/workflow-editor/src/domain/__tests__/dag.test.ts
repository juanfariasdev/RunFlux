import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from '../dag';
import type { WorkflowConnection } from '../types';

function connection(sourceNodeId: string, targetNodeId: string): WorkflowConnection {
  return { sourceNodeId, sourceOutput: 'main', targetNodeId, targetInput: 'main' };
}

describe('wouldCreateCycle', () => {
  it('allows a connection between two unconnected nodes', () => {
    expect(wouldCreateCycle([], 'a', 'b')).toBe(false);
  });

  it('allows extending a linear chain (a -> b, adding b -> c)', () => {
    const connections = [connection('a', 'b')];
    expect(wouldCreateCycle(connections, 'b', 'c')).toBe(false);
  });

  it('rejects a direct back-edge (a -> b exists, adding b -> a)', () => {
    const connections = [connection('a', 'b')];
    expect(wouldCreateCycle(connections, 'b', 'a')).toBe(true);
  });

  it('rejects an indirect cycle through two intermediate nodes (a -> b -> c, adding c -> a)', () => {
    const connections = [connection('a', 'b'), connection('b', 'c')];
    expect(wouldCreateCycle(connections, 'c', 'a')).toBe(true);
  });

  it('rejects a self-loop (a -> a)', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('allows a diamond shape (a -> b, a -> c, adding b -> d and c -> d)', () => {
    const connections = [connection('a', 'b'), connection('a', 'c')];
    expect(wouldCreateCycle(connections, 'b', 'd')).toBe(false);
    expect(wouldCreateCycle([...connections, connection('b', 'd')], 'c', 'd')).toBe(false);
  });

  it('does not falsely flag unrelated branches as cyclic', () => {
    const connections = [connection('a', 'b'), connection('x', 'y')];
    expect(wouldCreateCycle(connections, 'y', 'a')).toBe(false);
  });
});
