import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LEGAL_DOCUMENTS,
  SUB_PROCESSORS,
  SUB_PROCESSORS_VERSION,
  canManageOrganisation,
  outstandingLegalDocuments,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { lockedTransaction } from '../prisma/locked-transaction';
import type { AuthUser } from '../auth/auth.types';
import { recordAcceptance, TermsChangedError } from './terms';

@Injectable()
export class TermsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The current documents, what the workspace has accepted of each, and the
   * sub-processor list. Who accepted is shown to Admins only.
   */
  async status(user: AuthUser) {
    const rows = await this.prisma.termsAcceptance.findMany({
      where: { organisationId: user.organisationId },
      orderBy: { acceptedAt: 'desc' },
    });
    const admin = canManageOrganisation(user.role);
    const outstanding = outstandingLegalDocuments(rows).map((item) => item.key);
    return {
      outstanding,
      documents: LEGAL_DOCUMENTS.map((document) => {
        const latest = rows.find((row) => row.document === document.key);
        return {
          ...document,
          accepted: latest
            ? {
                version: latest.version,
                current: latest.version === document.version,
                acceptedAt: latest.acceptedAt,
                acceptedBy: admin ? latest.acceptedByName : null,
              }
            : null,
        };
      }),
      subProcessorsVersion: SUB_PROCESSORS_VERSION,
      subProcessors: SUB_PROCESSORS,
    };
  }

  async accept(user: AuthUser, versions: Record<string, string>) {
    try {
      await lockedTransaction(
        this.prisma,
        `terms:${user.organisationId}`,
        (tx) =>
          recordAcceptance(tx, {
            organisationId: user.organisationId,
            user: { id: user.id, name: user.name, email: user.email },
            versions,
          }),
      );
    } catch (error) {
      if (error instanceof TermsChangedError) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'terms_changed',
          message: error.message,
        });
      }
      throw error;
    }
    return this.status(user);
  }
}
