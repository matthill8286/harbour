import { parsePositiveNumber } from '../dashboard/ops-alerts';

/** A battery unit at or below this percentage is low. */
export const DEFAULT_LOW_BATTERY_PERCENT = 20;
/** A low battery counts as charged again only this far above the threshold. */
export const BATTERY_RECHARGED_MARGIN = 10;
/** A 12-volt vehicle battery below this is going flat. */
export const DEFAULT_LOW_SUPPLY_VOLTS = 11.8;
/** A unit still reporting this long after its job ended was left in the vehicle. */
export const DEFAULT_AFTER_JOB_GRACE_HOURS = 24;

type Read = (key: string) => string | undefined;

export function trackerThresholds(read: Read) {
  return {
    lowBatteryPercent: Math.min(
      100,
      parsePositiveNumber(
        read('GPS_LOW_BATTERY_PERCENT'),
        DEFAULT_LOW_BATTERY_PERCENT,
      ),
    ),
    lowSupplyVolts: parsePositiveNumber(
      read('GPS_LOW_SUPPLY_VOLTS'),
      DEFAULT_LOW_SUPPLY_VOLTS,
    ),
    afterJobGraceHours: parsePositiveNumber(
      read('GPS_AFTER_JOB_GRACE_HOURS'),
      DEFAULT_AFTER_JOB_GRACE_HOURS,
    ),
  };
}
