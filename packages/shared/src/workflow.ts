/**
 * Routes and their workflows. A workspace runs one or more routes, such as
 * UK → Cyprus or Japan → Cyprus. Each route has ordered stages, and each stage
 * has ordered statuses. A job follows the route it was created on: it moves to
 * the next status, from the last one to COMPLETED, and from anywhere to
 * CANCELLED. COMPLETED and CANCELLED belong to every workspace, not a route.
 *
 * These rules are shared, so the API enforces exactly what the web app offers.
 */

export const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const TERMINAL_LABELS: Record<TerminalStatus, string> = {
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** The seeded route's key. Only it has the UK → Cyprus GPS corridor wired to its statuses. */
export const UK_CYPRUS_ROUTE_KEY = 'uk-cyprus';

export type WorkflowStatusDef = { code: string; label: string };

export type WorkflowStageDef = {
  id: string;
  name: string;
  /** What the customer portal calls this stage. */
  customerName: string;
  /** Off: the customer sees it as part of the next visible stage. */
  customerVisible: boolean;
  statuses: WorkflowStatusDef[];
};

export type RouteWorkflow = {
  id: string;
  name: string;
  shortLabel: string;
  originCountry: string;
  destinationCountry: string;
  isDefault: boolean;
  /** Off while it is a draft: New job does not offer it. */
  active: boolean;
  systemKey: string | null;
  stages: WorkflowStageDef[];
};

export const isTerminalStatus = (code: string): code is TerminalStatus =>
  (TERMINAL_STATUSES as readonly string[]).includes(code);

/** Every status of the route, in the order a job moves through them. */
export function routeStatusCodes(
  route: Pick<RouteWorkflow, 'stages'>,
): string[] {
  return route.stages.flatMap((stage) =>
    stage.statuses.map((status) => status.code),
  );
}

export function firstStatus(
  route: Pick<RouteWorkflow, 'stages'>,
): string | null {
  return routeStatusCodes(route)[0] ?? null;
}

/** Where a job goes next: the following status, COMPLETED after the last, nothing once it is closed. */
export function nextStatus(
  route: Pick<RouteWorkflow, 'stages'>,
  code: string,
): string | null {
  if (isTerminalStatus(code)) return null;
  const codes = routeStatusCodes(route);
  const at = codes.indexOf(code);
  if (at === -1) return null;
  return codes[at + 1] ?? 'COMPLETED';
}

/** Why a move is not allowed, or null when it is. */
export function moveProblem(
  route: Pick<RouteWorkflow, 'stages'>,
  from: string,
  to: string,
): string | null {
  if (isTerminalStatus(from))
    return 'This job is closed, so its status cannot change.';
  if (!routeStatusCodes(route).includes(from))
    return 'This job is at a status its route no longer has.';
  if (to === 'CANCELLED') return null;
  if (to === nextStatus(route, from)) return null;
  return 'A job can only move to the next status, or be cancelled.';
}

export function statusLabel(
  route: Pick<RouteWorkflow, 'stages'>,
  code: string,
): string {
  if (isTerminalStatus(code)) return TERMINAL_LABELS[code];
  for (const stage of route.stages) {
    const match = stage.statuses.find((status) => status.code === code);
    if (match) return match.label;
  }
  return code;
}

/** The stage a status belongs to, or null for COMPLETED, CANCELLED and unknown codes. */
export function stageOfStatus(
  route: Pick<RouteWorkflow, 'stages'>,
  code: string,
): WorkflowStageDef | null {
  return (
    route.stages.find((stage) =>
      stage.statuses.some((status) => status.code === code),
    ) ?? null
  );
}

/**
 * The steps a customer sees, and which one their job is on. A hidden stage
 * counts as the next visible one, so the customer never sees it by name.
 */
export function customerProgress(
  route: Pick<RouteWorkflow, 'stages'>,
  code: string,
) {
  const steps = route.stages
    .filter((stage) => stage.customerVisible)
    .map((stage) => ({ id: stage.id, name: stage.customerName || stage.name }));
  if (code === 'COMPLETED') return { steps, current: steps.length };
  const stageIndex = route.stages.findIndex((stage) =>
    stage.statuses.some((status) => status.code === code),
  );
  if (stageIndex === -1) return { steps, current: 0 };
  const visibleFrom = route.stages
    .slice(stageIndex)
    .find((stage) => stage.customerVisible);
  const current = visibleFrom
    ? steps.findIndex((step) => step.id === visibleFrom.id)
    : steps.length;
  return { steps, current };
}

/** A stable code for a new status, unique within its route. */
export function newStatusCode(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize('NFKD')
      .replace(/[^\w\s]/g, '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '_')
      .slice(0, 40) || 'STATUS';
  let code = base;
  for (let n = 2; used.has(code) || isTerminalStatus(code); n += 1)
    code = `${base}_${n}`;
  return code;
}

/** Why a route cannot be switched on, or null when it can. */
export function routeProblem(
  route: Pick<RouteWorkflow, 'stages'>,
): string | null {
  if (route.stages.length === 0) return 'Add at least one stage first.';
  const empty = route.stages.find((stage) => stage.statuses.length === 0);
  if (empty) return `Add a status to ${empty.name} first.`;
  return null;
}

/** The seeded UK → Cyprus route. Its codes are the ones every existing job already uses. */
export const UK_CYPRUS_ROUTE_SEED = {
  systemKey: UK_CYPRUS_ROUTE_KEY,
  name: 'UK → Cyprus',
  shortLabel: 'GB → CY',
  originCountry: 'GB',
  destinationCountry: 'CY',
  stages: [
    {
      name: 'UK',
      customerName: 'UK',
      customerVisible: true,
      statuses: [
        { code: 'NEW', label: 'New' },
        { code: 'CONFIRMED', label: 'Confirmed' },
        { code: 'READY_FOR_COLLECTION', label: 'Ready for collection' },
        { code: 'COLLECTED', label: 'Collected' },
        { code: 'IN_TRANSIT_UK', label: 'In transit (UK)' },
      ],
    },
    {
      name: 'Registration',
      customerName: 'Registration',
      customerVisible: true,
      statuses: [
        {
          code: 'ARRIVED_REGISTRATION_COUNTRY',
          label: 'Arrived in registration country',
        },
        { code: 'REGISTRATION_IN_PROGRESS', label: 'Registration in progress' },
        { code: 'REGISTERED', label: 'Registered' },
      ],
    },
    {
      name: 'Greece',
      customerName: 'Greece',
      customerVisible: true,
      statuses: [
        { code: 'IN_TRANSIT_TO_GREECE', label: 'In transit to Greece' },
        { code: 'AT_GREECE', label: 'At Greece' },
      ],
    },
    {
      name: 'Shipping',
      customerName: 'Shipping',
      customerVisible: false,
      statuses: [{ code: 'SHIPPING_TO_CYPRUS', label: 'Shipping to Cyprus' }],
    },
    {
      name: 'Cyprus',
      customerName: 'Cyprus',
      customerVisible: true,
      statuses: [
        { code: 'ARRIVED_CYPRUS', label: 'Arrived in Cyprus' },
        {
          code: 'READY_FOR_CUSTOMER_COLLECTION',
          label: 'Ready for customer collection',
        },
      ],
    },
  ],
} as const;
