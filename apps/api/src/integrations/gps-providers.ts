const SIMULATED_PROVIDERS = new Set(['generic', 'sim', 'demo']);

export function isSimulatedGpsProvider(provider?: string | null) {
  return SIMULATED_PROVIDERS.has((provider ?? 'generic').trim().toLowerCase());
}
