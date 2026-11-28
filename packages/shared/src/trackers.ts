/**
 * Rules for the GPS units a workspace brings, shared by the API and the web
 * app so that both say the same thing about a unit.
 */

/**
 * How a unit is powered. A self-contained battery unit is the recommended kind:
 * it is not connected to the vehicle, so it needs no fitter and leaves the
 * vehicle unchanged. Hard-wired and diagnostic-port units are allowed with a
 * qualified fitter and the vehicle owner's written permission.
 */
export const TRACKER_POWER_SOURCES = ['BATTERY', 'HARD_WIRED', 'OBD'] as const;
export type TrackerPowerSource = (typeof TRACKER_POWER_SOURCES)[number];

export const TRACKER_POWER_SOURCE_LABELS: Record<TrackerPowerSource, string> = {
  BATTERY: 'Battery unit (recommended)',
  HARD_WIRED: 'Hard-wired to the vehicle',
  OBD: 'Plugged into the diagnostic (OBD) port',
};

/** Hard-wired and diagnostic-port units change the vehicle, so they need a fitter. */
export function needsFitter(powerSource: TrackerPowerSource) {
  return powerSource !== 'BATTERY';
}

/**
 * The version of the statements below. A new wording gets a new version, so
 * the record says exactly which words a person confirmed.
 */
export const TRACKER_STATEMENT_VERSION = '2026-11-28';

/** What a person confirms when they register a real unit. */
export const TRACKER_STATEMENTS: Record<TrackerPowerSource, string> = {
  BATTERY:
    'I confirm that this unit belongs to or is controlled by our workspace, that it is lawfully marked for the countries it will travel through, that it will be secured inside the vehicle with the owner’s permission and labelled as a tracking device, that the drivers and customers affected have been told about the tracking, and that it will be removed from the vehicle when the job is finished.',
  HARD_WIRED:
    'I confirm that this unit belongs to or is controlled by our workspace, that it is lawfully marked for the countries it will travel through, that a qualified fitter will install it with the vehicle owner’s written permission and labelled as a tracking device, that the drivers and customers affected have been told about the tracking, and that the fitter will remove it and restore the wiring when the job is finished.',
  OBD: 'I confirm that this unit belongs to or is controlled by our workspace, that it is lawfully marked for the countries it will travel through, that it will be fitted with the vehicle owner’s written permission and labelled as a tracking device, that it reads no data from the vehicle unless the people affected have agreed, that the drivers and customers affected have been told about the tracking, and that it will be removed when the job is finished.',
};

/** How often a unit is set to report when nobody says otherwise. */
export const DEFAULT_REPORT_INTERVAL_MINUTES = 60;
export const MIN_REPORT_INTERVAL_MINUTES = 1;
/** A battery unit can be set to report a few times a day. */
export const MAX_REPORT_INTERVAL_MINUTES = 24 * 60;

/** A unit counts as silent after missing this many expected reports. */
export const MISSED_REPORTS_FOR_NO_SIGNAL = 2;
/** However often a unit reports, a gap shorter than this is not called silence. */
export const MIN_NO_SIGNAL_MINUTES = 30;

/** Minutes without a report before a unit counts as having no signal. */
export function noSignalAfterMinutes(
  reportIntervalMinutes: number | null | undefined,
) {
  const interval =
    reportIntervalMinutes && reportIntervalMinutes > 0
      ? reportIntervalMinutes
      : DEFAULT_REPORT_INTERVAL_MINUTES;
  return Math.max(
    MIN_NO_SIGNAL_MINUTES,
    interval * MISSED_REPORTS_FOR_NO_SIGNAL,
  );
}

/**
 * Whether a unit is reporting.
 * - `LIVE`: it reported within its no-signal time.
 * - `NO_SIGNAL`: it has reported before, but not lately. Its position is a last
 *   known position, never the vehicle's current one.
 * - `NEVER`: it has never reported.
 */
export type TrackerSignalState = 'LIVE' | 'NO_SIGNAL' | 'NEVER';

export type TrackerSignal = {
  state: TrackerSignalState;
  /** When it last reported, or null. */
  lastSeenAt: string | null;
  /** How long without a report counts as no signal, for this unit. */
  noSignalAfterMinutes: number;
};

export function trackerSignal(
  tracker: {
    lastSeenAt: Date | string | null;
    reportIntervalMinutes?: number | null;
    status?: string | null;
  },
  now: Date | number = Date.now(),
): TrackerSignal {
  const after = noSignalAfterMinutes(tracker.reportIntervalMinutes);
  const seen =
    tracker.lastSeenAt == null ? NaN : new Date(tracker.lastSeenAt).getTime();
  if (!Number.isFinite(seen))
    return { state: 'NEVER', lastSeenAt: null, noSignalAfterMinutes: after };
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const live = tracker.status !== 'OFFLINE' && nowMs - seen < after * 60_000;
  return {
    state: live ? 'LIVE' : 'NO_SIGNAL',
    lastSeenAt: new Date(seen).toISOString(),
    noSignalAfterMinutes: after,
  };
}

/** "2 hours", "45 minutes", "1 day": how long a unit may be quiet. */
export function describeMinutes(minutes: number) {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** Where a stored position came from: the GPS gateway, or typed in by staff. */
export const LOCATION_SOURCES = ['GATEWAY', 'MANUAL'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

/** The GPS history a workspace may choose to keep, in days. */
export const MIN_GPS_RETENTION_DAYS = 30;
export const MAX_GPS_RETENTION_DAYS = 3650;
