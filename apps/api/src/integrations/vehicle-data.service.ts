import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VehicleLookupResult } from '@vip/shared';
import {
  emptyLookup,
  mapDvlaEnquiry,
  type DvlaVehicleEnquiry,
} from './dvla-vehicle-mapper';
import { OutboundStatusError, outboundCall } from './outbound-call';
import {
  formatUkRegistration,
  normalizeRegistrationKey,
} from './vehicle-registration';

const KNOWN: Record<string, VehicleLookupResult> = {
  KN19XPL: {
    registration: 'KN19 XPL',
    vin: 'WBSJF0C50KB123456',
    make: 'BMW',
    model: 'M5',
    variant: 'Competition',
    year: 2019,
    colour: 'Black Sapphire',
    fuelType: 'Petrol',
    engineSize: '4395cc',
    bodyType: 'Saloon',
    mileage: 31240,
    countryOfRegistration: 'GB',
    source: 'mock',
  },
  LF21TRK: {
    registration: 'LF21 TRK',
    vin: 'SALGA2BE8KA123789',
    make: 'Land Rover',
    model: 'Range Rover Sport',
    variant: 'HSE',
    year: 2021,
    colour: 'Santorini Black',
    fuelType: 'Diesel',
    engineSize: '2993cc',
    bodyType: 'SUV',
    mileage: 18400,
    countryOfRegistration: 'GB',
    source: 'mock',
  },
  RJ14XOO: {
    registration: 'RJ14 XOO',
    vin: 'WBS3C9C50E5A14001',
    make: 'BMW',
    model: 'M3',
    variant: 'F80',
    year: 2014,
    colour: 'Mineral Grey',
    fuelType: 'Petrol',
    engineSize: '2979cc',
    bodyType: 'Saloon',
    mileage: 48620,
    countryOfRegistration: 'GB',
    source: 'mock',
  },
};

export const DVLA_TIMEOUT_MS = 10_000;

@Injectable()
export class VehicleDataService {
  private readonly logger = new Logger(VehicleDataService.name);

  constructor(private readonly config: ConfigService) {}

  provider(): 'mock' | 'dvla' {
    const configured = this.config
      .get<string>('VEHICLE_DATA_PROVIDER', 'mock')
      .trim()
      .toLowerCase();
    if (configured === 'dvla' && this.dvlaKey()) {
      return 'dvla';
    }
    return 'mock';
  }

  /** False when the only source is sample data and this workspace may not see it. */
  available(sampleAllowed: boolean): boolean {
    return this.provider() !== 'mock' || sampleAllowed;
  }

  async lookup(
    registration: string,
    sampleAllowed: boolean,
  ): Promise<VehicleLookupResult> {
    if (!this.available(sampleAllowed)) {
      // Only the typed registration, so the job can still be created.
      return emptyLookup(formatUkRegistration(registration), 'unavailable');
    }
    if (this.provider() === 'dvla') {
      return this.lookupDvla(registration);
    }
    return this.lookupMock(registration);
  }

  private lookupMock(registration: string): VehicleLookupResult {
    const key = normalizeRegistrationKey(registration);
    if (KNOWN[key]) {
      return KNOWN[key];
    }
    return emptyLookup(registration, 'mock');
  }

  private async lookupDvla(registration: string): Promise<VehicleLookupResult> {
    const registrationNumber = normalizeRegistrationKey(registration);
    const base = this.config
      .get<string>(
        'DVLA_VES_URL',
        'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',
      )
      .replace(/\/$/, '');
    return outboundCall(this.logger, {
      service: 'DVLA',
      url: base,
      timeoutMs: DVLA_TIMEOUT_MS,
      unavailable:
        'The vehicle lookup is not answering. Please try again shortly.',
      init: {
        method: 'POST',
        headers: {
          'x-api-key': this.dvlaKey(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ registrationNumber }),
      },
      read: async (response) => {
        if (response.status === 404) {
          return emptyLookup(formatUkRegistration(registration), 'dvla');
        }
        if (!response.ok) throw new OutboundStatusError(response.status);
        const payload = (await response.json()) as DvlaVehicleEnquiry;
        return mapDvlaEnquiry(registration, payload);
      },
    });
  }

  private dvlaKey() {
    return this.config.get<string>('DVLA_API_KEY')?.trim() || '';
  }
}
