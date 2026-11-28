import {
  describeMinutes,
  needsFitter,
  TRACKER_POWER_SOURCE_LABELS,
  TRACKER_POWER_SOURCES,
  TRACKER_STATEMENT_VERSION,
  type TrackerPowerSource,
} from '@vip/shared';

/** How often a unit can be set to report. Battery units usually report less often. */
export const REPORT_INTERVALS = [5, 15, 30, 60, 180, 360, 720, 1440];

export const POWER_SOURCE_OPTIONS = TRACKER_POWER_SOURCES.map((value) => ({ value, label: TRACKER_POWER_SOURCE_LABELS[value] }));

export function intervalOptions(current?: number) {
  const values = current && !REPORT_INTERVALS.includes(current) ? [...REPORT_INTERVALS, current].sort((a, b) => a - b) : REPORT_INTERVALS;
  return values.map((minutes) => ({ value: String(minutes), label: everyLabel(minutes) }));
}

/** "Every 15 minutes", "Every hour", "Every day". */
export function everyLabel(minutes: number) {
  if (minutes === 60) return 'Every hour';
  if (minutes === 24 * 60) return 'Every day';
  return `Every ${describeMinutes(minutes)}`;
}

/** The words for how a unit is powered, without the recommendation. */
export function powerSourceName(powerSource: TrackerPowerSource) {
  return { BATTERY: 'Battery unit', HARD_WIRED: 'Hard-wired', OBD: 'Diagnostic (OBD) port' }[powerSource];
}

export type TrackerDetails = {
  powerSource: TrackerPowerSource;
  reportIntervalMinutes: number;
  fittedBy: string;
  ownerPermissionHeld: boolean;
};

export const EMPTY_DETAILS: TrackerDetails = { powerSource: 'BATTERY', reportIntervalMinutes: 60, fittedBy: '', ownerPermissionHeld: false };

/** What the API takes for these details. */
export function detailsBody(details: TrackerDetails) {
  return {
    powerSource: details.powerSource,
    reportIntervalMinutes: details.reportIntervalMinutes,
    ...(needsFitter(details.powerSource) ? { fittedBy: details.fittedBy.trim(), ownerPermissionHeld: details.ownerPermissionHeld } : {}),
  };
}

/** What the API takes to record the statement. */
export const statementBody = (confirmed: boolean) => ({ statementConfirmed: confirmed, statementVersion: TRACKER_STATEMENT_VERSION });
