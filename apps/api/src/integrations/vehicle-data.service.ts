import { Injectable } from '@nestjs/common';
import type { VehicleLookupResult } from '@vip/shared';

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
};

@Injectable()
export class VehicleDataService {
  lookup(registration: string): VehicleLookupResult {
    const key = registration.replace(/\s+/g, '').toUpperCase();
    if (KNOWN[key]) {
      return KNOWN[key];
    }
    return {
      registration: registration.toUpperCase().replace(/\s+/g, ' ').trim(),
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
      source: 'mock',
    };
  }
}
