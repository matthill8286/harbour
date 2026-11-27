/** Used only if neither the job nor the workspace has a usable country code. */
const FALLBACK_COUNTRY = 'CY';

const countryCode = (value: string) => {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
};

/**
 * The letters a job reference starts with: the job's destination country, or
 * the workspace's country if the destination is not a two-letter code.
 */
export function jobReferencePrefix(
  destinationCountry: string,
  workspaceCountry: string,
) {
  return (
    countryCode(destinationCountry) ??
    countryCode(workspaceCountry) ??
    FALLBACK_COUNTRY
  );
}
