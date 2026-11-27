/** Country names for the codes a corridor uses. An unknown code is shown as it is. */
const COUNTRIES: Record<string, string> = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  BG: 'Bulgaria',
  GR: 'Greece',
  CY: 'Cyprus',
  MT: 'Malta',
  DE: 'Germany',
  NL: 'Netherlands',
  FR: 'France',
  IT: 'Italy',
  JP: 'Japan',
  AE: 'United Arab Emirates',
  US: 'United States',
};

export const countryName = (code: string) => COUNTRIES[code] ?? code;
export const COUNTRY_CODES = Object.keys(COUNTRIES);
