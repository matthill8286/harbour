import { randomBytes } from 'crypto';

/** A URL-safe slug from the company name, with a short random tail so it is unique. */
export function organisationSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const tail = randomBytes(3).toString('hex');
  return `${base || 'workspace'}-${tail}`;
}
