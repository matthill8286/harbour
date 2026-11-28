/**
 * A workspace's acceptance of the agreements in @vip/shared. An Admin accepts
 * for the whole workspace. Each version of each document is accepted once, and
 * a new version asks for acceptance again.
 */
import type { Prisma } from '@prisma/client';
import {
  LEGAL_DOCUMENTS,
  SUB_PROCESSORS_VERSION,
  type LegalDocumentKey,
} from '@vip/shared';

export class TermsChangedError extends Error {
  constructor() {
    super(
      'The agreements have changed since this page was opened. Reload the page to read the current versions.',
    );
  }
}

/**
 * The versions a person saw must be the current ones, for every document. A
 * page left open while a version changed cannot accept the old wording.
 */
export function assertCurrentVersions(
  versions: Partial<Record<string, unknown>> | null | undefined,
): Record<LegalDocumentKey, string> {
  const seen = versions ?? {};
  for (const document of LEGAL_DOCUMENTS) {
    if (seen[document.key] !== document.version) throw new TermsChangedError();
  }
  if (Object.keys(seen).length !== LEGAL_DOCUMENTS.length) {
    throw new TermsChangedError();
  }
  return Object.fromEntries(
    LEGAL_DOCUMENTS.map((document) => [document.key, document.version]),
  ) as Record<LegalDocumentKey, string>;
}

/**
 * Records the current version of every document for the workspace, and audits
 * each new acceptance. Versions it already accepted are left as they were, so
 * the record keeps the first person and time.
 */
export async function recordAcceptance(
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    user: { id: string; name: string; email: string };
    versions: Partial<Record<string, unknown>> | null | undefined;
  },
  now = new Date(),
) {
  assertCurrentVersions(input.versions);
  const accepted: Array<{ document: LegalDocumentKey; version: string }> = [];
  for (const document of LEGAL_DOCUMENTS) {
    const existing = await tx.termsAcceptance.findUnique({
      where: {
        organisationId_document_version: {
          organisationId: input.organisationId,
          document: document.key,
          version: document.version,
        },
      },
      select: { id: true },
    });
    if (existing) continue;
    const row = await tx.termsAcceptance.create({
      data: {
        organisationId: input.organisationId,
        document: document.key,
        version: document.version,
        subProcessorsVersion: SUB_PROCESSORS_VERSION,
        acceptedById: input.user.id,
        acceptedByName: input.user.name,
        acceptedByEmail: input.user.email,
        acceptedAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        organisationId: input.organisationId,
        actorId: input.user.id,
        action: 'TERMS_ACCEPTED',
        entityType: 'TermsAcceptance',
        entityId: row.id,
        metadata: {
          document: document.key,
          version: document.version,
          subProcessorsVersion: SUB_PROCESSORS_VERSION,
        },
        createdAt: now,
      },
    });
    accepted.push({ document: document.key, version: document.version });
  }
  return accepted;
}
