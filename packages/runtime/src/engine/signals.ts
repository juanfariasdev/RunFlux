/** A signal that never aborts, for work nothing can cancel. */
export const NEVER_ABORTED: AbortSignal = new AbortController().signal;

/** A signal that aborts as soon as any of the given ones does. */
export function anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (present.length === 0) return NEVER_ABORTED;
  return present.length === 1 ? present[0] : AbortSignal.any(present);
}
