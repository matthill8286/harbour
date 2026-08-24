import { randomUUID } from 'node:crypto';

export type TenantObjectKind = 'documents' | 'photos';

export function tenantObjectKey(input: {
  organisationId: string;
  importJobId: string;
  kind: TenantObjectKind;
  originalName: string;
  id?: string;
}): string {
  const ext = input.originalName.includes('.')
    ? input.originalName.slice(input.originalName.lastIndexOf('.'))
    : '';
  return `${input.organisationId}/jobs/${input.importJobId}/${input.kind}/${input.id ?? randomUUID()}${ext}`;
}

export function isSafeObjectKey(key: string, organisationId?: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    return false;
  }
  if (organisationId && !key.startsWith(`${organisationId}/`)) {
    return false;
  }
  return true;
}

export function monthStartUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}
