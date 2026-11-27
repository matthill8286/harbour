import {
  customerProgress,
  JOB_STATUSES,
  moveProblem,
  newStatusCode,
  nextStatus,
  routeProblem,
  routeStatusCodes,
  statusLabel,
  UK_CYPRUS_ROUTE_SEED,
  type RouteWorkflow,
} from '@vip/shared';

const seeded: Pick<RouteWorkflow, 'stages'> = {
  stages: UK_CYPRUS_ROUTE_SEED.stages.map((stage, index) => ({
    ...stage,
    id: `stage-${index}`,
    statuses: [...stage.statuses],
  })),
};

describe('route workflow rules', () => {
  it('seeds UK → Cyprus with exactly the statuses existing jobs already use, in order', () => {
    const open = JOB_STATUSES.filter(
      (code) => code !== 'COMPLETED' && code !== 'CANCELLED',
    );
    expect(routeStatusCodes(seeded)).toEqual(open);
  });

  it('moves a job to the next status, then to COMPLETED after the last', () => {
    expect(nextStatus(seeded, 'NEW')).toBe('CONFIRMED');
    expect(nextStatus(seeded, 'IN_TRANSIT_UK')).toBe(
      'ARRIVED_REGISTRATION_COUNTRY',
    );
    expect(nextStatus(seeded, 'READY_FOR_CUSTOMER_COLLECTION')).toBe(
      'COMPLETED',
    );
    expect(nextStatus(seeded, 'COMPLETED')).toBeNull();
  });

  it('allows the next status or cancelling, and nothing else', () => {
    expect(moveProblem(seeded, 'NEW', 'CONFIRMED')).toBeNull();
    expect(moveProblem(seeded, 'AT_GREECE', 'CANCELLED')).toBeNull();
    expect(moveProblem(seeded, 'NEW', 'REGISTERED')).toMatch(/next status/);
    expect(moveProblem(seeded, 'CONFIRMED', 'NEW')).toMatch(/next status/);
    expect(moveProblem(seeded, 'COMPLETED', 'CANCELLED')).toMatch(/closed/);
    expect(moveProblem(seeded, 'GONE', 'CANCELLED')).toMatch(/no longer/);
  });

  it('labels route statuses and the two that every workspace has', () => {
    expect(statusLabel(seeded, 'AT_GREECE')).toBe('At Greece');
    expect(statusLabel(seeded, 'CANCELLED')).toBe('Cancelled');
  });

  it('shows the customer a hidden stage as the next visible one', () => {
    const shipping = customerProgress(seeded, 'SHIPPING_TO_CYPRUS');
    expect(shipping.steps.map((s) => s.name)).toEqual([
      'UK',
      'Registration',
      'Greece',
      'Cyprus',
    ]);
    expect(shipping.steps[shipping.current].name).toBe('Cyprus');
    expect(customerProgress(seeded, 'AT_GREECE').current).toBe(2);
    expect(customerProgress(seeded, 'COMPLETED').current).toBe(4);
  });

  it('makes status codes that never clash with each other or with the closing statuses', () => {
    expect(newStatusCode('At the port', [])).toBe('AT_THE_PORT');
    expect(newStatusCode('At the port', ['AT_THE_PORT'])).toBe('AT_THE_PORT_2');
    expect(newStatusCode('Completed', [])).toBe('COMPLETED_2');
    expect(newStatusCode('→ ✓', [])).toBe('STATUS');
  });

  it('will not switch on a route without stages or with an empty stage', () => {
    expect(routeProblem({ stages: [] })).toMatch(/at least one stage/);
    expect(
      routeProblem({
        stages: [
          {
            id: 's',
            name: 'Japan',
            customerName: 'Japan',
            customerVisible: true,
            statuses: [],
          },
        ],
      }),
    ).toMatch(/Add a status to Japan/);
    expect(routeProblem(seeded)).toBeNull();
  });
});
