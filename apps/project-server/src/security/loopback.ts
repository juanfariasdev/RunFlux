import { isIPv4 } from 'node:net';

/** Whether listening on `host` keeps the server reachable from this machine only: `localhost`, `::1` or `127.0.0.0/8`. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  return isIPv4(normalized) && normalized.startsWith('127.');
}

/** Whether a connection's remote address is this machine, IPv4-mapped IPv6 addresses included. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const unmapped = address.toLowerCase().startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return unmapped === '::1' || (isIPv4(unmapped) && unmapped.startsWith('127.'));
}
