import { Injectable } from '@nestjs/common';
import { VehicleDataService } from './vehicle-data.service';

@Injectable()
export class AnprService {
  constructor(private readonly vehicleData: VehicleDataService) {}

  /**
   * Mock ANPR: uses the original filename if it looks like a plate,
   * otherwise returns the seeded BMW plate so the staff flow is testable.
   */
  recognise(originalName: string) {
    const cleaned = originalName
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
    const plate = /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned) ? cleaned : 'KN19XPL';
    const formatted = `${plate.slice(0, 4)} ${plate.slice(4)}`;
    return {
      registration: formatted,
      confidence: 0.92,
      lookup: this.vehicleData.lookup(formatted),
    };
  }
}
