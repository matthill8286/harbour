export const DEFAULT_GPS_RETENTION_DAYS = 90;

/** Fewer days would remove trails while a delivery may still be questioned. */
const MIN_DAYS = 30;
const MAX_DAYS = 3650;

/**
 * Reads GPS_RETENTION_DAYS. A value that is not a safe number of days throws,
 * because guessing could delete history that cannot be brought back.
 */
export function gpsRetentionDays(value: string | undefined) {
  const text = value?.trim();
  if (!text) return DEFAULT_GPS_RETENTION_DAYS;
  const days = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(days >= MIN_DAYS && days <= MAX_DAYS)) {
    throw new Error(
      `GPS_RETENTION_DAYS must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}, not "${text}"`,
    );
  }
  return days;
}
