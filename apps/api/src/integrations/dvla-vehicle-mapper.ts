import type { VehicleLookupResult } from '@vip/shared';
import { formatUkRegistration } from './vehicle-registration';

export type DvlaVehicleEnquiry = {
  registrationNumber?: string;
  make?: string;
  colour?: string;
  fuelType?: string;
  yearOfManufacture?: number;
  engineCapacity?: number;
  typeApproval?: string;
  monthOfFirstRegistration?: string;
};

export function mapDvlaEnquiry(
  registration: string,
  payload: DvlaVehicleEnquiry,
): VehicleLookupResult {
  const reg =
    payload.registrationNumber?.trim() ||
    formatUkRegistration(registration);
  return {
    registration: formatUkRegistration(reg),
    vin: null,
    make: titleCase(payload.make),
    model: null,
    variant: null,
    year:
      typeof payload.yearOfManufacture === 'number'
        ? payload.yearOfManufacture
        : null,
    colour: titleCase(payload.colour),
    fuelType: titleCase(payload.fuelType),
    engineSize:
      typeof payload.engineCapacity === 'number'
        ? `${payload.engineCapacity}cc`
        : null,
    bodyType: payload.typeApproval?.trim() || null,
    mileage: null,
    countryOfRegistration: 'GB',
    source: 'dvla',
  };
}

export function emptyLookup(
  registration: string,
  source: string,
): VehicleLookupResult {
  return {
    registration: formatUkRegistration(registration),
    vin: null,
    make: null,
    model: null,
    variant: null,
    year: null,
    colour: null,
    fuelType: null,
    engineSize: null,
    bodyType: null,
    mileage: null,
    countryOfRegistration: 'GB',
    source,
  };
}

function titleCase(value?: string | null) {
  if (!value?.trim()) return null;
  const lower = value.trim().toLowerCase();
  return lower.replace(/\b\w/g, (char) => char.toUpperCase());
}
