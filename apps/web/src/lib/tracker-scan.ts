const IMEI_PATTERN = /\d{15}/;
const DEMO_SERIAL_PATTERN = /^TRK-\d+$/i;

/** Extract a tracker serial (IMEI) from a QR or barcode payload. */
export function parseTrackerImeiFromScan(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (DEMO_SERIAL_PATTERN.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ['imei', 'IMEI', 'serial', 'serialNumber', 'ident']) {
      const value = parsed[key];
      if (typeof value === 'string') {
        const normalised = normaliseTrackerSerial(value);
        if (normalised) return normalised;
      }
    }
  } catch {
    // Not JSON — fall through to text parsing.
  }

  const labelled = trimmed.match(/(?:IMEI|imei|serial|S\/N)[:=\s#-]*(\d{15}|[A-Z0-9-]+)/i);
  if (labelled?.[1]) {
    const normalised = normaliseTrackerSerial(labelled[1]);
    if (normalised) return normalised;
  }

  const urlMatch = trimmed.match(/[?&](?:imei|serial|ident)=([^&]+)/i);
  if (urlMatch?.[1]) {
    const normalised = normaliseTrackerSerial(decodeURIComponent(urlMatch[1]));
    if (normalised) return normalised;
  }

  return normaliseTrackerSerial(trimmed);
}

function normaliseTrackerSerial(value: string): string | null {
  const trimmed = value.trim();
  if (DEMO_SERIAL_PATTERN.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const digits = trimmed.replace(/\D/g, '');
  const imei = digits.match(IMEI_PATTERN)?.[0];
  return imei ?? null;
}
