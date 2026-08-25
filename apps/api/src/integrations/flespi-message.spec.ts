import { parseFlespiBatch, parseFlespiPing } from './flespi-message';

const sample = {
  ident: '352625333222111',
  'position.altitude': 273.61,
  'position.hdop': 0.7,
  'position.latitude': 49.069782,
  'position.longitude': 28.632826,
  'position.speed': 78,
  'position.direction': 142,
  'battery.level': 87,
  timestamp: 1650636570.426424,
};

describe('parseFlespiPing', () => {
  it('maps a Flespi HTTP stream message', () => {
    const ping = parseFlespiPing(sample);
    expect(ping).toMatchObject({
      ident: '352625333222111',
      latitude: 49.069782,
      longitude: 28.632826,
      speed: 78,
      heading: 142,
      batteryLevel: 87,
    });
    expect(ping?.recordedAt.getTime()).toBe(
      Math.round(1650636570.426424 * 1000),
    );
    expect(ping?.accuracy).toBe(3.5);
  });

  it('accepts nested position objects', () => {
    const ping = parseFlespiPing({
      ident: '111',
      timestamp: 1_700_000_000,
      position: { latitude: 34.68, longitude: 33.04, speed: 12, heading: 90 },
    });
    expect(ping).toMatchObject({
      ident: '111',
      latitude: 34.68,
      longitude: 33.04,
      speed: 12,
      heading: 90,
    });
  });

  it('drops messages without a fix', () => {
    expect(parseFlespiPing({ ident: '111', timestamp: 1 })).toBeNull();
    expect(
      parseFlespiPing({
        ident: '111',
        'position.latitude': 91,
        'position.longitude': 0,
        timestamp: 1,
      }),
    ).toBeNull();
  });
});

describe('parseFlespiBatch', () => {
  it('sorts a stream batch by recorded time', () => {
    const later = {
      ...sample,
      timestamp: 1650636580,
      ident: '352625333222111',
    };
    const pings = parseFlespiBatch([later, sample]);
    expect(pings.map((ping) => ping.recordedAt.getTime())).toEqual([
      Math.round(1650636570.426424 * 1000),
      1650636580000,
    ]);
  });

  it('ignores junk around a valid message', () => {
    expect(parseFlespiBatch([null, sample, { foo: 1 }])).toHaveLength(1);
  });
});
