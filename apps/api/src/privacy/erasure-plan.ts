import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { isTerminalStatus } from '@vip/shared';
import {
  DOCUMENT_RULES,
  mentions,
  PHOTO_RULES,
  type Disposition,
} from './erasure-rules';

export type PlannedFile = {
  kind: 'DOCUMENT' | 'PHOTO';
  id: string;
  importJobId: string;
  storageKey: string;
  mimeType: string;
  /** The document type or photo category. */
  category: string;
  disposition: Disposition;
};

export type FlaggedMoney = {
  kind: 'COST' | 'CHARGE';
  id: string;
  importJobId: string;
};

export type ErasurePlan = NonNullable<
  Awaited<ReturnType<typeof buildErasurePlan>>
>;

/**
 * Everything erasing one customer of one workspace would touch. The preview and
 * the erasure both come from here, so they cannot disagree.
 */
export async function buildErasurePlan(
  db: Prisma.TransactionClient,
  organisationId: string,
  customerId: string,
) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, organisationId },
  });
  if (!customer) return null;
  const jobs = await db.importJob.findMany({
    where: { organisationId, customerId },
    select: { id: true, reference: true, status: true, vehicleId: true },
    orderBy: { createdAt: 'asc' },
  });
  const jobIds = jobs.map((job) => job.id);
  const onJobs = { organisationId, importJobId: { in: jobIds } };

  const vehicleIds = [...new Set(jobs.map((job) => job.vehicleId))];
  // A vehicle also on another customer's job keeps what is recorded against it.
  const shared = await db.importJob.findMany({
    where: {
      organisationId,
      vehicleId: { in: vehicleIds },
      customerId: { not: customerId },
    },
    select: { vehicleId: true },
  });
  const ownVehicleIds = vehicleIds.filter(
    (id) => !shared.some((job) => job.vehicleId === id),
  );

  const [documents, photos, tasks, costs, charges, journeys, history] =
    await Promise.all([
      db.document.findMany({ where: onJobs, orderBy: { createdAt: 'asc' } }),
      db.photo.findMany({ where: onJobs, orderBy: { createdAt: 'asc' } }),
      db.task.findMany({ where: onJobs, select: { id: true } }),
      db.cost.findMany({ where: onJobs }),
      db.customerCharge.findMany({ where: onJobs }),
      db.journey.count({ where: onJobs }),
      db.jobStatusHistory.count({ where: { ...onJobs, note: { not: null } } }),
    ]);

  const files: PlannedFile[] = [
    ...documents.map((file) => ({
      ...plannedFile(file),
      kind: 'DOCUMENT' as const,
      category: file.type,
      disposition: DOCUMENT_RULES[file.type],
    })),
    ...photos.map((file) => ({
      ...plannedFile(file),
      kind: 'PHOTO' as const,
      category: file.category,
      disposition: PHOTO_RULES[file.category],
    })),
  ];

  const flaggedMoney: FlaggedMoney[] = [
    ...costs
      .filter((cost) =>
        [cost.description, cost.supplier, cost.invoiceReference].some((text) =>
          mentions(customer, text),
        ),
      )
      .map(({ id, importJobId }) => ({
        kind: 'COST' as const,
        id,
        importJobId,
      })),
    ...charges
      .filter((charge) => mentions(customer, charge.description))
      .map(({ id, importJobId }) => ({
        kind: 'CHARGE' as const,
        id,
        importJobId,
      })),
  ];

  const noteFilter: Prisma.NoteWhereInput = {
    organisationId,
    OR: [
      { customerId },
      { importJobId: { in: jobIds } },
      { taskId: { in: tasks.map((task) => task.id) } },
      { vehicleId: { in: ownVehicleIds } },
    ],
  };
  const gpsFilter: Prisma.LocationEventWhereInput = {
    organisationId,
    OR: [
      { importJobId: { in: jobIds } },
      { importJobId: null, vehicleId: { in: ownVehicleIds } },
    ],
  };

  const [memberships, invites] = await Promise.all([
    db.organisationMembership.findMany({
      where: { organisationId, customerId, role: 'CUSTOMER' },
      select: { id: true, userId: true },
    }),
    db.portalInvite.findMany({
      where: { organisationId, customerId },
      select: { id: true, userId: true },
    }),
  ]);
  // Invites too: access moved to another address leaves only the old invite.
  const userIds = [
    ...new Set([...memberships, ...invites].map((item) => item.userId)),
  ];

  const auditFilter: Prisma.AuditLogWhereInput = {
    organisationId,
    OR: [
      { entityId: { in: [customerId, ...jobIds] } },
      { entityId: { in: memberships.map((item) => item.id) } },
      { metadata: { path: ['customerId'], equals: customerId } },
      ...jobIds.map((id) => ({
        metadata: { path: ['importJobId'], equals: id },
      })),
    ],
  };

  const [notes, gpsPoints, auditEntries] = await Promise.all([
    db.note.findMany({ where: noteFilter, select: { id: true } }),
    db.locationEvent.count({ where: gpsFilter }),
    db.auditLog.count({ where: auditFilter }),
  ]);

  return {
    customer,
    jobs,
    openJobs: jobs.filter((job) => !isTerminalStatus(job.status)),
    ownVehicleIds,
    vehicleCount: vehicleIds.length,
    files,
    flaggedMoney,
    costCount: costs.length,
    chargeCount: charges.length,
    noteIds: notes.map((note) => note.id),
    noteFilter,
    gpsFilter,
    gpsPoints,
    auditFilter,
    auditEntries,
    taskCount: tasks.length,
    journeyCount: journeys,
    statusNoteCount: history,
    membershipCount: memberships.length,
    inviteCount: invites.length,
    userIds,
  };
}

function plannedFile(file: {
  id: string;
  importJobId: string;
  storageKey: string;
  mimeType: string;
}) {
  const { id, importJobId, storageKey, mimeType } = file;
  return { id, importJobId, storageKey, mimeType };
}

/**
 * Names exactly what a preview showed. The erasure runs only if what it would
 * touch is still that, so nothing is erased that the Admin has not seen.
 */
export function planFingerprint(plan: ErasurePlan): string {
  const { customer } = plan;
  return createHash('sha256')
    .update(
      JSON.stringify([
        customer.id,
        customer.updatedAt.toISOString(),
        plan.jobs.map((job) => [job.id, job.status]),
        plan.files.map((file) => [file.id, file.disposition]).sort(),
        [...plan.noteIds].sort(),
        plan.flaggedMoney.map((item) => item.id).sort(),
        [plan.costCount, plan.chargeCount, plan.taskCount, plan.journeyCount],
        [plan.membershipCount, plan.inviteCount, plan.statusNoteCount],
      ]),
    )
    .digest('hex');
}
