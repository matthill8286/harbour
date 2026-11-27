/** The workspaces the seed creates. Sign-up adds a random tail, so it cannot take these. */
export const DEMO_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  'demo-imports',
  'cyprus-auto-logistics',
]);

/**
 * Mock providers return made-up vehicles. In production only the demo
 * workspaces may see them.
 */
export function sampleDataAllowed(
  nodeEnv: string | undefined,
  organisationSlug: string | undefined,
): boolean {
  if (nodeEnv !== 'production') return true;
  return !!organisationSlug && DEMO_WORKSPACE_SLUGS.has(organisationSlug);
}
