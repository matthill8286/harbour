import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'argon2';
import {
  DEFAULT_WORKFLOW_STATUSES,
  ROUTE_TEMPLATE_DEFINITIONS,
  ROUTE_UK_BG_GR_CENTRAL,
  bearingDegrees,
  densifyRoute,
} from '@vip/shared';

const prisma = new PrismaClient();

async function seedRouteTemplates() {
  for (const definition of ROUTE_TEMPLATE_DEFINITIONS) {
    await prisma.routeTemplate.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        description: definition.description,
        waypoints: definition.waypoints,
        sortOrder: definition.sortOrder,
        active: true,
        organisationId: null,
      },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        waypoints: definition.waypoints,
        sortOrder: definition.sortOrder,
        active: true,
        organisationId: null,
      },
    });
  }
  return prisma.routeTemplate.findUniqueOrThrow({
    where: { code: 'UK_BG_GR_CENTRAL' },
  });
}

async function upsertMember(input: {
  organisationId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  customerId?: string;
}) {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: { passwordHash: input.passwordHash, name: input.name },
    create: {
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
    },
  });
  await prisma.organisationMembership.upsert({
    where: {
      organisationId_userId: { organisationId: input.organisationId, userId: user.id },
    },
    update: {
      role: input.role,
      status: 'ACTIVE',
      customerId: input.customerId ?? null,
    },
    create: {
      organisationId: input.organisationId,
      userId: user.id,
      role: input.role,
      status: 'ACTIVE',
      customerId: input.customerId,
    },
  });
  return user;
}

async function seedOrganisationPlatform(
  organisationId: string,
  input: { brandName: string; plan: 'STARTER' | 'BUSINESS'; status: 'TRIAL' | 'ACTIVE' },
) {
  await prisma.organisationSettings.upsert({
    where: { organisationId },
    update: { brandName: input.brandName },
    create: { organisationId, brandName: input.brandName },
  });
  await prisma.subscription.upsert({
    where: { organisationId },
    update: { plan: input.plan, status: input.status },
    create: {
      organisationId,
      plan: input.plan,
      status: input.status,
      billingCycle: 'MONTHLY',
      startedAt: new Date('2026-08-01'),
      renewalAt: new Date('2026-09-01'),
    },
  });
  for (const flag of ['GPS_TRACKING', 'CUSTOMER_PORTAL'] as const) {
    await prisma.organisationFeature.upsert({
      where: { organisationId_flag: { organisationId, flag } },
      update: { enabled: true },
      create: { organisationId, flag, enabled: true },
    });
  }
}

async function main() {
  const passwordHash = await hash('ChangeMe!Admin1');
  const staffHash = await hash('ChangeMe!Staff1');
  const viewerHash = await hash('ChangeMe!Viewer1');
  const customerHash = await hash('ChangeMe!Customer1');
  const centralRoute = await seedRouteTemplates();

  const organisation = await prisma.organisation.upsert({
    where: { slug: 'demo-imports' },
    update: {
      legalName: 'Demo Imports Ltd',
      country: 'CY',
      currency: 'EUR',
      timezone: 'Europe/Nicosia',
      status: 'ACTIVE',
    },
    create: {
      name: 'Demo Imports Ltd',
      legalName: 'Demo Imports Ltd',
      slug: 'demo-imports',
      country: 'CY',
      currency: 'EUR',
      timezone: 'Europe/Nicosia',
      status: 'ACTIVE',
    },
  });

  await seedOrganisationPlatform(organisation.id, {
    brandName: 'Demo Imports',
    plan: 'BUSINESS',
    status: 'ACTIVE',
  });

  const secondOrg = await prisma.organisation.upsert({
    where: { slug: 'cyprus-auto-logistics' },
    update: { status: 'ACTIVE', timezone: 'Europe/Nicosia' },
    create: {
      name: 'Cyprus Auto Logistics',
      legalName: 'Cyprus Auto Logistics Ltd',
      slug: 'cyprus-auto-logistics',
      country: 'CY',
      currency: 'EUR',
      timezone: 'Europe/Nicosia',
    },
  });
  await seedOrganisationPlatform(secondOrg.id, {
    brandName: 'Cyprus Auto Logistics',
    plan: 'STARTER',
    status: 'TRIAL',
  });
  await upsertMember({
    organisationId: secondOrg.id,
    email: 'owner@cyprus-auto.local',
    passwordHash,
    name: 'Chris Owner',
    role: UserRole.OWNER,
  });

  await prisma.workflowStatus.deleteMany({
    where: { organisationId: organisation.id },
  });

  await prisma.workflowStatus.createMany({
    data: DEFAULT_WORKFLOW_STATUSES.map((status) => ({
      organisationId: organisation.id,
      code: status.code,
      label: status.label,
      sortOrder: status.sortOrder,
      isTerminal: status.isTerminal,
    })),
  });

  const admin = await upsertMember({
    organisationId: organisation.id,
    email: 'admin@demo-imports.local',
    passwordHash,
    name: 'Alex Admin',
    role: UserRole.OWNER,
  });

  await upsertMember({
    organisationId: organisation.id,
    email: 'staff@demo-imports.local',
    passwordHash: staffHash,
    name: 'Sam Staff',
    role: UserRole.STAFF,
  });

  await upsertMember({
    organisationId: organisation.id,
    email: 'viewer@demo-imports.local',
    passwordHash: viewerHash,
    name: 'Val Viewer',
    role: UserRole.VIEWER,
  });

  const john = await prisma.customer.upsert({
    where: { id: 'seed-customer-john' },
    update: {},
    create: {
      id: 'seed-customer-john',
      organisationId: organisation.id,
      firstName: 'John',
      lastName: 'Smith',
      email: 'customer@example.com',
      phone: '+357 99 123456',
      address: 'Limassol, Cyprus',
      notes: 'Prefers weekend collection.',
    },
  });

  await upsertMember({
    organisationId: organisation.id,
    email: 'customer@example.com',
    passwordHash: customerHash,
    name: 'John Smith',
    role: UserRole.CUSTOMER,
    customerId: john.id,
  });

  const maria = await prisma.customer.upsert({
    where: { id: 'seed-customer-maria' },
    update: {},
    create: {
      id: 'seed-customer-maria',
      organisationId: organisation.id,
      firstName: 'Maria',
      lastName: 'Christou',
      email: 'maria@example.com',
      phone: '+357 99 654321',
      address: 'Nicosia, Cyprus',
    },
  });

  const bmw = await prisma.vehicle.upsert({
    where: { id: 'seed-vehicle-m5' },
    update: {},
    create: {
      id: 'seed-vehicle-m5',
      organisationId: organisation.id,
      vin: 'WBSJF0C50KB123456',
      make: 'BMW',
      model: 'M5',
      variant: 'Competition',
      year: 2019,
      mileage: 31240,
      fuelType: 'Petrol',
      colour: 'Black Sapphire',
      engineSize: '4395cc',
      bodyType: 'Saloon',
      countryOfRegistration: 'GB',
      ukRegistration: 'KN19 XPL',
    },
  });

  const rangeRover = await prisma.vehicle.upsert({
    where: { id: 'seed-vehicle-rr' },
    update: {},
    create: {
      id: 'seed-vehicle-rr',
      organisationId: organisation.id,
      vin: 'SALGA2BE8KA123789',
      make: 'Land Rover',
      model: 'Range Rover Sport',
      variant: 'HSE',
      year: 2021,
      mileage: 18400,
      fuelType: 'Diesel',
      colour: 'Santorini Black',
      countryOfRegistration: 'GB',
      ukRegistration: 'LF21 TRK',
    },
  });

  const existingJob = await prisma.importJob.findUnique({
    where: {
      organisationId_reference: {
        organisationId: organisation.id,
        reference: 'CY-2026-00421',
      },
    },
  });

  if (!existingJob) {
    const job = await prisma.importJob.create({
      data: {
        organisationId: organisation.id,
        customerId: john.id,
        vehicleId: bmw.id,
        reference: 'CY-2026-00421',
        status: 'IN_TRANSIT_TO_GREECE',
        originCountry: 'GB',
        destinationCountry: 'CY',
        registrationCountry: 'BG',
        expectedDeliveryDate: new Date('2026-09-15'),
        startedAt: new Date('2026-08-20'),
        routeTemplateId: centralRoute.id,
      },
    });

    await prisma.vehicleRegistration.create({
      data: {
        organisationId: organisation.id,
        vehicleId: bmw.id,
        kind: 'UK',
        number: 'KN19 XPL',
        country: 'GB',
      },
    });

    await seedJobTimeline(organisation.id, job.id, admin.id);

    await prisma.journey.createMany({
      data: [
        {
          organisationId: organisation.id,
          importJobId: job.id,
          type: 'ROAD',
          origin: 'United Kingdom',
          destination: 'Bulgaria',
          status: 'COMPLETED',
          startedAt: new Date('2026-08-23T09:32:00Z'),
          completedAt: new Date('2026-08-24T18:15:00Z'),
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          type: 'ROAD',
          origin: 'Bulgaria',
          destination: 'Greece',
          status: 'IN_PROGRESS',
          startedAt: new Date('2026-08-29T08:00:00Z'),
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          type: 'FERRY',
          origin: 'Greece',
          destination: 'Cyprus',
          status: 'PLANNED',
        },
      ],
    });

    await prisma.note.createMany({
      data: [
        {
          organisationId: organisation.id,
          importJobId: job.id,
          authorId: admin.id,
          body: 'Customer wants delivery before 15 September.',
          visibility: 'INTERNAL',
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          authorId: admin.id,
          body: 'Vehicle has left Bulgaria and is travelling to Greece.',
          visibility: 'CUSTOMER',
        },
      ],
    });

    await prisma.task.createMany({
      data: [
        {
          organisationId: organisation.id,
          importJobId: job.id,
          title: 'Arrange Greece transport',
          status: 'COMPLETED',
          priority: 'HIGH',
          completedAt: new Date('2026-08-28T17:00:00Z'),
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          title: 'Book Cyprus shipping',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          dueDate: new Date('2026-09-02'),
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          title: 'Upload final photos',
          status: 'TODO',
          priority: 'MEDIUM',
          dueDate: new Date('2026-09-12'),
        },
      ],
    });

    await prisma.cost.createMany({
      data: [
        {
          organisationId: organisation.id,
          importJobId: job.id,
          category: 'TRANSPORT',
          description: 'UK to Bulgaria transport',
          amount: '1200.00',
          currency: 'EUR',
          supplier: 'EuroHaul',
          invoiceReference: 'EH-88421',
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          category: 'REGISTRATION',
          description: 'Bulgarian registration fees',
          amount: '450.00',
          currency: 'EUR',
        },
      ],
    });

    await prisma.customerCharge.createMany({
      data: [
        {
          organisationId: organisation.id,
          importJobId: job.id,
          category: 'TRANSPORT',
          description: 'Transport service',
          amount: '1800.00',
          currency: 'EUR',
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          category: 'REGISTRATION_SERVICE',
          description: 'Registration service',
          amount: '950.00',
          currency: 'EUR',
        },
        {
          organisationId: organisation.id,
          importJobId: job.id,
          category: 'IMPORT_SERVICE',
          description: 'Import management',
          amount: '1200.00',
          currency: 'EUR',
        },
      ],
    });

    const tracker = await prisma.tracker.create({
      data: {
        organisationId: organisation.id,
        serialNumber: 'TRK-001',
        provider: 'generic',
        status: 'ASSIGNED',
        batteryLevel: 82,
        lastSeenAt: new Date(),
      },
    });

    await prisma.trackerAssignment.create({
      data: {
        organisationId: organisation.id,
        trackerId: tracker.id,
        vehicleId: bmw.id,
        importJobId: job.id,
      },
    });

    await seedJourneyTrail(organisation.id, job.id, bmw.id, tracker.id);
  } else {
    await prisma.importJob.update({
      where: { id: existingJob.id },
      data: {
        status: 'IN_TRANSIT_TO_GREECE',
        completedAt: null,
        routeTemplateId: centralRoute.id,
      },
    });
    await seedJobTimeline(organisation.id, existingJob.id, admin.id);
    const assignment = await prisma.trackerAssignment.findFirst({
      where: { importJobId: existingJob.id, removedAt: null },
    });
    if (assignment) {
      await seedJourneyTrail(
        organisation.id,
        existingJob.id,
        existingJob.vehicleId,
        assignment.trackerId,
      );
    }
  }

  const existingMariaJob = await prisma.importJob.findUnique({
    where: {
      organisationId_reference: {
        organisationId: organisation.id,
        reference: 'CY-2026-00388',
      },
    },
  });

  if (!existingMariaJob) {
    await prisma.importJob.create({
      data: {
        organisationId: organisation.id,
        customerId: maria.id,
        vehicleId: rangeRover.id,
        reference: 'CY-2026-00388',
        status: 'READY_FOR_COLLECTION',
        originCountry: 'GB',
        destinationCountry: 'CY',
        registrationCountry: 'NL',
        expectedDeliveryDate: new Date('2026-10-01'),
        routeTemplateId: centralRoute.id,
        tasks: {
          create: {
            organisationId: organisation.id,
            title: 'Collect vehicle',
            status: 'TODO',
            priority: 'HIGH',
            dueDate: new Date('2026-08-26'),
          },
        },
      },
    });
  } else {
    await prisma.importJob.update({
      where: { id: existingMariaJob.id },
      data: { status: 'READY_FOR_COLLECTION', completedAt: null },
    });
  }

  const bmwJob = await prisma.importJob.findUnique({
    where: {
      organisationId_reference: { organisationId: organisation.id, reference: 'CY-2026-00421' },
    },
  });
  const mariaJob = await prisma.importJob.findUnique({
    where: {
      organisationId_reference: { organisationId: organisation.id, reference: 'CY-2026-00388' },
    },
  });
  if (bmwJob) await seedPortalFiles(organisation.id, bmwJob.id, admin.id, 'bmw', 'KN19 XPL collection');
  if (mariaJob) await seedPortalFiles(organisation.id, mariaJob.id, admin.id, 'rr', 'LF21 TRK collection');

  const jobCount = await prisma.importJob.count({ where: { organisationId: organisation.id } });
  const periodStart = new Date(Date.UTC(2026, 7, 1));
  await prisma.usageRecord.upsert({
    where: {
      organisationId_metric_periodStart: {
        organisationId: organisation.id,
        metric: 'IMPORT_JOBS',
        periodStart,
      },
    },
    update: { quantity: jobCount },
    create: {
      organisationId: organisation.id,
      metric: 'IMPORT_JOBS',
      periodStart,
      quantity: jobCount,
    },
  });

  await prisma.tracker.upsert({
    where: {
      organisationId_serialNumber: {
        organisationId: organisation.id,
        serialNumber: 'TRK-002',
      },
    },
    update: {},
    create: {
      organisationId: organisation.id,
      serialNumber: 'TRK-002',
      provider: 'generic',
      status: 'AVAILABLE',
      batteryLevel: 100,
    },
  });

  console.log('Seed complete.');
  console.log('  Founding tenant: Demo Imports Ltd');
  console.log('  Owner:    admin@demo-imports.local / ChangeMe!Admin1');
  console.log('  Staff:    staff@demo-imports.local / ChangeMe!Staff1');
  console.log('  Viewer:   viewer@demo-imports.local / ChangeMe!Viewer1');
  console.log('  Customer: customer@example.com / ChangeMe!Customer1');
  console.log('  Second tenant owner: owner@cyprus-auto.local / ChangeMe!Admin1');
}

const SEED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function seedPdf(label: string) {
  const body = `Collection update: ${label}.`;
  return Buffer.from(
    `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R>>endobj
4 0 obj<</Length ${body.length + 38}>>stream
BT /F1 12 Tf 24 120 Td (${body}) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF
`,
  );
}

async function seedPortalFiles(
  organisationId: string,
  importJobId: string,
  uploadedById: string,
  slug: string,
  label: string,
) {
  const photoKey = `${organisationId}/jobs/${importJobId}/photos/seed-${slug}-collection.png`;
  const docKey = `${organisationId}/jobs/${importJobId}/documents/seed-${slug}-collection.pdf`;
  const root = process.env.STORAGE_LOCAL_DIR ?? './uploads';
  await mkdir(join(root, organisationId, 'jobs', importJobId, 'photos'), { recursive: true });
  await mkdir(join(root, organisationId, 'jobs', importJobId, 'documents'), { recursive: true });
  const pdf = seedPdf(label);
  await writeFile(join(root, photoKey), SEED_PNG);
  await writeFile(join(root, docKey), pdf);

  await prisma.photo.upsert({
    where: { id: `seed-photo-${slug}` },
    update: { importJobId, organisationId, customerVisible: true, storageKey: photoKey },
    create: {
      id: `seed-photo-${slug}`,
      organisationId,
      importJobId,
      category: 'COLLECTION',
      filename: `${slug}-collection.png`,
      mimeType: 'image/png',
      storageKey: photoKey,
      sizeBytes: SEED_PNG.length,
      uploadedById,
      customerVisible: true,
    },
  });

  await prisma.document.upsert({
    where: { id: `seed-doc-${slug}` },
    update: { importJobId, organisationId, customerVisible: true, storageKey: docKey, sizeBytes: pdf.length },
    create: {
      id: `seed-doc-${slug}`,
      organisationId,
      importJobId,
      type: 'CUSTOMER',
      name: 'Collection update.pdf',
      mimeType: 'application/pdf',
      storageKey: docKey,
      sizeBytes: pdf.length,
      uploadedById,
      customerVisible: true,
    },
  });
}

async function seedJobTimeline(organisationId: string, importJobId: string, changedById: string) {
  await prisma.jobStatusHistory.deleteMany({ where: { importJobId } });
  await prisma.jobStatusHistory.createMany({
    data: [
      {
        organisationId,
        importJobId,
        fromStatus: null,
        toStatus: 'NEW',
        changedById,
        note: 'Import job created',
        createdAt: new Date('2026-08-20T08:00:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'NEW',
        toStatus: 'CONFIRMED',
        changedById,
        note: 'Booking confirmed',
        createdAt: new Date('2026-08-20T10:15:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'CONFIRMED',
        toStatus: 'READY_FOR_COLLECTION',
        changedById,
        note: 'Ready for UK collection',
        createdAt: new Date('2026-08-22T14:00:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'READY_FOR_COLLECTION',
        toStatus: 'COLLECTED',
        changedById,
        note: 'Vehicle collected in UK',
        createdAt: new Date('2026-08-23T09:32:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'COLLECTED',
        toStatus: 'IN_TRANSIT_UK',
        changedById,
        note: 'En route to the Channel',
        createdAt: new Date('2026-08-23T12:10:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'IN_TRANSIT_UK',
        toStatus: 'ARRIVED_REGISTRATION_COUNTRY',
        changedById,
        note: 'Arrived in Bulgaria',
        createdAt: new Date('2026-08-24T18:15:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'ARRIVED_REGISTRATION_COUNTRY',
        toStatus: 'REGISTRATION_IN_PROGRESS',
        changedById,
        note: 'Registration process started',
        createdAt: new Date('2026-08-26T11:20:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'REGISTRATION_IN_PROGRESS',
        toStatus: 'REGISTERED',
        changedById,
        note: 'Registration completed',
        createdAt: new Date('2026-08-28T16:40:00Z'),
      },
      {
        organisationId,
        importJobId,
        fromStatus: 'REGISTERED',
        toStatus: 'IN_TRANSIT_TO_GREECE',
        changedById,
        note: 'Departed for Greece',
        createdAt: new Date('2026-08-29T08:00:00Z'),
      },
    ],
  });
}

async function seedJourneyTrail(
  organisationId: string,
  importJobId: string,
  vehicleId: string,
  trackerId: string,
) {
  await prisma.locationEvent.deleteMany({ where: { importJobId } });
  const route = densifyRoute(ROUTE_UK_BG_GR_CENTRAL, 4);
  const travelled = route.slice(0, 41);
  const started = new Date('2026-08-23T09:32:00Z').getTime();
  const lastRecordedAt = new Date(started + (travelled.length - 1) * 3.5 * 60 * 60 * 1000);
  await prisma.locationEvent.createMany({
    data: travelled.map((point, index) => {
      const previous = travelled[Math.max(0, index - 1)];
      return {
        organisationId,
        trackerId,
        vehicleId,
        importJobId,
        latitude: point.latitude.toFixed(7),
        longitude: point.longitude.toFixed(7),
        accuracy: '10.00',
        speed: (72 + (index % 9)).toFixed(2),
        heading: bearingDegrees(previous, point).toFixed(2),
        recordedAt: new Date(started + index * 3.5 * 60 * 60 * 1000),
      };
    }),
  });
  await prisma.tracker.update({
    where: { id: trackerId },
    data: { lastSeenAt: lastRecordedAt, status: 'ASSIGNED', batteryLevel: 82 },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
