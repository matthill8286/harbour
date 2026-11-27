import { Prisma } from '@prisma/client';
import { SIMULATED_GPS_PROVIDERS } from './gps-providers';

/**
 * The identity of a real unit. Two registrations with the same key are the same
 * device, however the IMEI was typed. `imeiKeySql` must give the same result.
 */
export function imeiKey(serialNumber: string) {
  return serialNumber.replace(/[\s-]+/g, '').toLowerCase();
}

/** Held while a claim on a real IMEI is checked and saved. */
export const imeiLock = (key: string) => `gps-imei:${key}`;

export const imeiKeySql = Prisma.raw(
  `lower(regexp_replace("serialNumber", '[[:space:]-]+', '', 'g'))`,
);

export const realProviderSql = Prisma.raw(
  `lower(btrim("provider")) NOT IN (${SIMULATED_GPS_PROVIDERS.map((p) => `'${p}'`).join(', ')})`,
);
