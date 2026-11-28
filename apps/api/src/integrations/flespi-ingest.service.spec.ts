import { FlespiIngestService } from './flespi-ingest.service';

const message = (ident: string) => ({
  ident,
  recordedAt: new Date(),
  latitude: 34.6841,
  longitude: 33.0379,
  speed: null,
  heading: null,
  accuracy: null,
  batteryLevel: null,
});

function setup(tracker: Record<string, unknown>) {
  const prisma = {
    tracker: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'trk-1',
        organisationId: 'org-1',
        serialNumber: '352625333222111',
        provider: 'flespi',
        ownershipConfirmedAt: new Date(0),
        imeiConflictAt: null,
        ...tracker,
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const flespi = {
    configured: () => true,
    latestForImei: jest.fn().mockResolvedValue([]),
  };
  const service = new FlespiIngestService(
    prisma as never,
    flespi as never,
    { get: () => undefined } as never,
    { sendLowBattery: jest.fn() } as never,
  );
  return { service, prisma, flespi };
}

describe('FlespiIngestService.syncTracker', () => {
  it.each([
    ['nobody has confirmed', { ownershipConfirmedAt: null }],
    ['the claim is disputed', { imeiConflictAt: new Date() }],
  ])('does not ask the gateway when %s', async (_name, tracker) => {
    const { service, flespi } = setup(tracker);
    await expect(service.syncTracker('org-1', 'trk-1')).rejects.toThrow(
      'confirmed that your workspace owns this unit',
    );
    expect(flespi.latestForImei).not.toHaveBeenCalled();
  });

  it('ignores a gateway message for another device', async () => {
    const { service, prisma, flespi } = setup({});
    flespi.latestForImei.mockResolvedValue([message('999999999999999')]);
    await expect(service.syncTracker('org-1', 'trk-1')).resolves.toEqual({
      received: 0,
      accepted: 0,
      skipped: 0,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
