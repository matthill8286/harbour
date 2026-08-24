export const USER_ROLES = ['OWNER', 'ADMIN', 'STAFF', 'VIEWER', 'CUSTOMER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Internal desk roles that can mutate operational records. */
export const STAFF_ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const satisfies readonly UserRole[];

/** Internal desk roles including read-only viewers. */
export const STAFF_READ_ROLES = ['OWNER', 'ADMIN', 'STAFF', 'VIEWER'] as const satisfies readonly UserRole[];

export function isStaffRole(role: UserRole): boolean {
  return role !== 'CUSTOMER';
}

export function isPortalRole(role: UserRole): boolean {
  return role === 'CUSTOMER';
}

export function canWriteStaff(role: UserRole): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'STAFF';
}

export const ORGANISATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INVITED', 'DISABLED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const SUBSCRIPTION_PLANS = ['STARTER', 'BUSINESS', 'PROFESSIONAL', 'ENTERPRISE'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const FEATURE_FLAGS = [
  'GPS_TRACKING',
  'CUSTOMER_PORTAL',
  'WHATSAPP',
  'ADVANCED_REPORTING',
  'SUPPLIER_PORTAL',
  'API_ACCESS',
  'WHITE_LABEL',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const JOB_STATUSES = [
  'NEW',
  'CONFIRMED',
  'READY_FOR_COLLECTION',
  'COLLECTED',
  'IN_TRANSIT_UK',
  'ARRIVED_REGISTRATION_COUNTRY',
  'REGISTRATION_IN_PROGRESS',
  'REGISTERED',
  'IN_TRANSIT_TO_GREECE',
  'AT_GREECE',
  'SHIPPING_TO_CYPRUS',
  'ARRIVED_CYPRUS',
  'READY_FOR_CUSTOMER_COLLECTION',
  'COMPLETED',
  'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DEFAULT_WORKFLOW_STATUSES: ReadonlyArray<{
  code: JobStatus;
  label: string;
  sortOrder: number;
  isTerminal: boolean;
  stage: JobStage;
}> = [
  { code: 'NEW', label: 'New', sortOrder: 10, isTerminal: false, stage: 'uk' },
  { code: 'CONFIRMED', label: 'Confirmed', sortOrder: 20, isTerminal: false, stage: 'uk' },
  {
    code: 'READY_FOR_COLLECTION',
    label: 'Ready for collection',
    sortOrder: 30,
    isTerminal: false,
    stage: 'uk',
  },
  { code: 'COLLECTED', label: 'Collected', sortOrder: 40, isTerminal: false, stage: 'uk' },
  {
    code: 'IN_TRANSIT_UK',
    label: 'In transit (UK)',
    sortOrder: 50,
    isTerminal: false,
    stage: 'uk',
  },
  {
    code: 'ARRIVED_REGISTRATION_COUNTRY',
    label: 'Arrived in registration country',
    sortOrder: 60,
    isTerminal: false,
    stage: 'registration',
  },
  {
    code: 'REGISTRATION_IN_PROGRESS',
    label: 'Registration in progress',
    sortOrder: 70,
    isTerminal: false,
    stage: 'registration',
  },
  { code: 'REGISTERED', label: 'Registered', sortOrder: 80, isTerminal: false, stage: 'registration' },
  {
    code: 'IN_TRANSIT_TO_GREECE',
    label: 'In transit to Greece',
    sortOrder: 90,
    isTerminal: false,
    stage: 'greece',
  },
  { code: 'AT_GREECE', label: 'At Greece', sortOrder: 100, isTerminal: false, stage: 'greece' },
  {
    code: 'SHIPPING_TO_CYPRUS',
    label: 'Shipping to Cyprus',
    sortOrder: 110,
    isTerminal: false,
    stage: 'shipping',
  },
  {
    code: 'ARRIVED_CYPRUS',
    label: 'Arrived in Cyprus',
    sortOrder: 120,
    isTerminal: false,
    stage: 'cyprus',
  },
  {
    code: 'READY_FOR_CUSTOMER_COLLECTION',
    label: 'Ready for customer collection',
    sortOrder: 130,
    isTerminal: false,
    stage: 'cyprus',
  },
  { code: 'COMPLETED', label: 'Completed', sortOrder: 140, isTerminal: true, stage: 'completed' },
  { code: 'CANCELLED', label: 'Cancelled', sortOrder: 150, isTerminal: true, stage: 'cancelled' },
];

export const JOB_STAGES = [
  'uk',
  'registration',
  'greece',
  'shipping',
  'cyprus',
  'completed',
  'cancelled',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  uk: 'UK',
  registration: 'Registration',
  greece: 'Greece',
  shipping: 'Shipping',
  cyprus: 'Cyprus',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const CUSTOMER_JOURNEY_STEPS = [
  { key: 'uk', label: 'UK', emoji: '🇬🇧' },
  { key: 'registration', label: 'Registration', emoji: '🇪🇺' },
  { key: 'greece', label: 'Greece', emoji: '🇬🇷' },
  { key: 'cyprus', label: 'Cyprus', emoji: '🇨🇾' },
] as const;

export function getJobStage(status: JobStatus): JobStage {
  const match = DEFAULT_WORKFLOW_STATUSES.find((item) => item.code === status);
  return match?.stage ?? 'uk';
}

export function getStatusLabel(status: JobStatus): string {
  return DEFAULT_WORKFLOW_STATUSES.find((item) => item.code === status)?.label ?? status;
}

export type CorridorJourneyStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';

const statusIndex = (status: JobStatus) => JOB_STATUSES.indexOf(status);

/** UK → registration country → Greece → Cyprus legs shown to customers. */
export function journeyStatusesForJob(status: JobStatus): CorridorJourneyStatus[] {
  if (status === 'CANCELLED') {
    return ['PLANNED', 'PLANNED', 'PLANNED'];
  }
  const index = statusIndex(status);
  if (index < statusIndex('COLLECTED')) return ['PLANNED', 'PLANNED', 'PLANNED'];
  if (index < statusIndex('ARRIVED_REGISTRATION_COUNTRY')) return ['IN_PROGRESS', 'PLANNED', 'PLANNED'];
  if (index < statusIndex('IN_TRANSIT_TO_GREECE')) return ['COMPLETED', 'PLANNED', 'PLANNED'];
  if (index < statusIndex('AT_GREECE')) return ['COMPLETED', 'IN_PROGRESS', 'PLANNED'];
  if (index < statusIndex('SHIPPING_TO_CYPRUS')) return ['COMPLETED', 'COMPLETED', 'PLANNED'];
  if (index < statusIndex('ARRIVED_CYPRUS')) return ['COMPLETED', 'COMPLETED', 'IN_PROGRESS'];
  return ['COMPLETED', 'COMPLETED', 'COMPLETED'];
}

export function isDestinationReached(status: JobStatus) {
  return (
    status === 'ARRIVED_CYPRUS' ||
    status === 'READY_FOR_CUSTOMER_COLLECTION' ||
    status === 'COMPLETED'
  );
}

/** Named waypoint on UK_TO_CYPRUS_ROUTE that GPS must have reached for this status. */
export function routeAnchorLabel(status: JobStatus): string {
  if (status === 'CANCELLED') return 'London';
  const index = statusIndex(status);
  if (index < statusIndex('COLLECTED')) return 'London';
  if (index < statusIndex('ARRIVED_REGISTRATION_COUNTRY')) return 'Brussels';
  if (index < statusIndex('IN_TRANSIT_TO_GREECE')) return 'Sofia';
  if (index < statusIndex('AT_GREECE')) return 'Thessaloniki';
  if (index < statusIndex('ARRIVED_CYPRUS')) return 'Piraeus';
  return 'Limassol';
}

export const STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['READY_FOR_COLLECTION', 'CANCELLED'],
  READY_FOR_COLLECTION: ['COLLECTED', 'CANCELLED'],
  COLLECTED: ['IN_TRANSIT_UK', 'CANCELLED'],
  IN_TRANSIT_UK: ['ARRIVED_REGISTRATION_COUNTRY', 'CANCELLED'],
  ARRIVED_REGISTRATION_COUNTRY: ['REGISTRATION_IN_PROGRESS', 'CANCELLED'],
  REGISTRATION_IN_PROGRESS: ['REGISTERED', 'CANCELLED'],
  REGISTERED: ['IN_TRANSIT_TO_GREECE', 'CANCELLED'],
  IN_TRANSIT_TO_GREECE: ['AT_GREECE', 'CANCELLED'],
  AT_GREECE: ['SHIPPING_TO_CYPRUS', 'CANCELLED'],
  SHIPPING_TO_CYPRUS: ['ARRIVED_CYPRUS', 'CANCELLED'],
  ARRIVED_CYPRUS: ['READY_FOR_CUSTOMER_COLLECTION', 'CANCELLED'],
  READY_FOR_CUSTOMER_COLLECTION: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const COST_CATEGORIES = [
  'TRANSPORT',
  'REGISTRATION',
  'IMPORT',
  'DOCUMENTATION',
  'REPAIRS',
  'STORAGE',
  'ADMINISTRATIVE',
  'OTHER',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const CHARGE_CATEGORIES = [
  'TRANSPORT',
  'IMPORT_SERVICE',
  'REGISTRATION_SERVICE',
  'OTHER',
] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

export const PHOTO_CATEGORIES = [
  'BEFORE_COLLECTION',
  'COLLECTION',
  'DAMAGE',
  'MILEAGE',
  'VIN',
  'REGISTRATION',
  'ARRIVAL',
  'FINAL',
  'OTHER',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const DOCUMENT_TYPES = [
  'V5C',
  'PURCHASE_INVOICE',
  'TRANSPORT',
  'IMPORT',
  'REGISTRATION',
  'CUSTOMS',
  'CUSTOMER',
  'INSPECTION',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const NOTE_VISIBILITIES = ['INTERNAL', 'CUSTOMER'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const JOURNEY_TYPES = ['ROAD', 'FERRY', 'OTHER'] as const;
export type JourneyType = (typeof JOURNEY_TYPES)[number];

export const JOURNEY_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const TRACKER_STATUSES = ['AVAILABLE', 'ASSIGNED', 'OFFLINE', 'RETIRED'] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

export const REGISTRATION_KINDS = ['UK', 'TEMPORARY', 'CYPRUS', 'OTHER'] as const;
export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];

export type PublicUser = {
  id: string;
  membershipId: string;
  organisationId: string;
  organisationName: string;
  email: string;
  name: string;
  role: UserRole;
  customerId: string | null;
};

export type VehicleLookupResult = {
  registration: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  colour: string | null;
  fuelType: string | null;
  engineSize: string | null;
  bodyType: string | null;
  mileage: number | null;
  countryOfRegistration: string | null;
  source: string;
};

export type GeoPoint = {
  label: string;
  latitude: number;
  longitude: number;
};

export type LocationPoint = {
  id?: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
};

export type MapConfig = {
  provider: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
};

/** Planned UK → Cyprus corridor used for demo GPS trails. */
export const UK_TO_CYPRUS_ROUTE: GeoPoint[] = [
  { label: 'London', latitude: 51.5074, longitude: -0.1278 },
  { label: 'Dover', latitude: 51.1279, longitude: 1.3134 },
  { label: 'Calais', latitude: 50.9513, longitude: 1.8587 },
  { label: 'Brussels', latitude: 50.8503, longitude: 4.3517 },
  { label: 'Cologne', latitude: 50.9375, longitude: 6.9603 },
  { label: 'Nuremberg', latitude: 49.4521, longitude: 11.0767 },
  { label: 'Vienna', latitude: 48.2082, longitude: 16.3738 },
  { label: 'Budapest', latitude: 47.4979, longitude: 19.0402 },
  { label: 'Belgrade', latitude: 44.7866, longitude: 20.4489 },
  { label: 'Sofia', latitude: 42.6977, longitude: 23.3219 },
  { label: 'Kulata', latitude: 41.3851, longitude: 23.362 },
  { label: 'Thessaloniki', latitude: 40.6401, longitude: 22.9444 },
  { label: 'Larissa', latitude: 39.639, longitude: 22.4191 },
  { label: 'Igoumenitsa', latitude: 39.5033, longitude: 20.2656 },
  { label: 'Patras', latitude: 38.2466, longitude: 21.7346 },
  { label: 'Piraeus', latitude: 37.942, longitude: 23.646 },
  { label: 'Limassol', latitude: 34.7071, longitude: 33.0226 },
];

export function densifyRoute(points: GeoPoint[], stepsPerLeg = 4): GeoPoint[] {
  const result: GeoPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    result.push(points[i]);
    const next = points[i + 1];
    if (!next) continue;
    for (let step = 1; step < stepsPerLeg; step += 1) {
      const t = step / stepsPerLeg;
      result.push({
        label: `${points[i].label} → ${next.label}`,
        latitude: points[i].latitude + (next.latitude - points[i].latitude) * t,
        longitude: points[i].longitude + (next.longitude - points[i].longitude) * t,
      });
    }
  }
  return result;
}

export function bearingDegrees(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const fromLat = (from.latitude * Math.PI) / 180;
  const toLat = (to.latitude * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

export function nearestRouteIndex(
  points: GeoPoint[],
  current: { latitude: number; longitude: number },
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance =
      (point.latitude - current.latitude) ** 2 + (point.longitude - current.longitude) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
