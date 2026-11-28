export type FlespiPing = {
  ident: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  batteryLevel: number | null;
  /** The vehicle's supply voltage, sent by a hard-wired or diagnostic-port unit. */
  supplyVoltage: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function read(message: Record<string, unknown>, path: string): unknown {
  if (path in message) return message[path];
  const parts = path.split('.');
  let current: unknown = message;
  for (const part of parts) {
    const record = asRecord(current);
    if (!record || !(part in record)) return undefined;
    current = record[part];
  }
  return current;
}

function readNumber(
  message: Record<string, unknown>,
  ...paths: string[]
): number | null {
  for (const path of paths) {
    const value = read(message, path);
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function recordedAt(message: Record<string, unknown>): Date | null {
  const unix = readNumber(
    message,
    'timestamp',
    'gps.timestamp',
    'server.timestamp',
  );
  if (unix == null) return null;
  const millis = unix > 1e12 ? unix : unix * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function batteryLevel(message: Record<string, unknown>): number | null {
  const raw = readNumber(message, 'battery.level', 'battery.percentage');
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** A vehicle system is 12 or 24 volts. Anything outside 0 to 60 is a bad reading. */
function supplyVoltage(message: Record<string, unknown>): number | null {
  const volts = readNumber(
    message,
    'external.powersource.voltage',
    'power.voltage',
  );
  if (volts == null || volts < 0 || volts > 60) return null;
  return Math.round(volts * 100) / 100;
}

function accuracyMetres(message: Record<string, unknown>): number | null {
  const accuracy = readNumber(message, 'position.accuracy', 'position.hdop');
  if (accuracy == null) return null;
  if (read(message, 'position.accuracy') != null) return accuracy;
  return Math.round(accuracy * 5 * 10) / 10;
}

export function parseFlespiPing(value: unknown): FlespiPing | null {
  const message = asRecord(value);
  if (!message) return null;
  const identRaw = read(message, 'ident') ?? read(message, 'device.imei');
  const ident =
    typeof identRaw === 'string'
      ? identRaw.trim()
      : typeof identRaw === 'number'
        ? String(identRaw).trim()
        : '';
  const latitude = readNumber(message, 'position.latitude', 'latitude');
  const longitude = readNumber(message, 'position.longitude', 'longitude');
  const at = recordedAt(message);
  if (!ident || latitude == null || longitude == null || at == null)
    return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const heading = readNumber(
    message,
    'position.direction',
    'position.heading',
    'heading',
  );
  return {
    ident,
    latitude,
    longitude,
    recordedAt: at,
    speed: readNumber(message, 'position.speed', 'speed'),
    heading: heading == null ? null : ((heading % 360) + 360) % 360,
    accuracy: accuracyMetres(message),
    batteryLevel: batteryLevel(message),
    supplyVoltage: supplyVoltage(message),
  };
}

export function parseFlespiBatch(body: unknown): FlespiPing[] {
  const items = Array.isArray(body) ? body : body == null ? [] : [body];
  return items
    .map(parseFlespiPing)
    .filter((item): item is FlespiPing => item != null)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}
