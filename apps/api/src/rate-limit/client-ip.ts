import { isIPv6 } from 'node:net';

/**
 * The address a limit counts. One IPv6 customer is usually given a whole /64,
 * so every address in it counts as one.
 */
export function rateLimitAddress(ip: string | undefined): string {
  const address = (ip ?? '').split('%')[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!isIPv6(address)) return address || 'unknown';
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}
