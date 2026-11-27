export const SIMULATED_GPS_PROVIDERS = ['generic', 'sim', 'demo'] as const;

/** A tracker added without a provider is a real unit, so nothing is invented for it. */
export const DEFAULT_GPS_PROVIDER = 'flespi';

const SIMULATED = new Set<string>(SIMULATED_GPS_PROVIDERS);

/** Only a provider named as simulated is one. A missing provider is not. */
export function isSimulatedGpsProvider(provider?: string | null) {
  return SIMULATED.has((provider ?? '').trim().toLowerCase());
}
