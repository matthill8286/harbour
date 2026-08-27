import { mapDvlaEnquiry, emptyLookup } from './dvla-vehicle-mapper';

describe('mapDvlaEnquiry', () => {
  it('maps VES fields into VehicleLookupResult', () => {
    const result = mapDvlaEnquiry('aa19aaa', {
      registrationNumber: 'AA19AAA',
      make: 'FORD',
      colour: 'RED',
      fuelType: 'PETROL',
      yearOfManufacture: 2019,
      engineCapacity: 2000,
      typeApproval: 'M1',
    });

    expect(result).toMatchObject({
      registration: 'AA19 AAA',
      make: 'Ford',
      colour: 'Red',
      fuelType: 'Petrol',
      year: 2019,
      engineSize: '2000cc',
      bodyType: 'M1',
      source: 'dvla',
      vin: null,
      mileage: null,
    });
  });

  it('falls back to the requested registration when VES omits it', () => {
    expect(mapDvlaEnquiry('kn19xpl', {}).registration).toBe('KN19 XPL');
  });
});

describe('emptyLookup', () => {
  it('keeps the source tag', () => {
    expect(emptyLookup('lf21trk', 'mock').source).toBe('mock');
  });
});
