/** Strip spaces and uppercase for map keys / API calls. */
export function normalizeRegistrationKey(registration: string) {
  return registration.replace(/\s+/g, '').toUpperCase();
}

/** Format a UK-style plate for display (AB12 CDE → AB12 CDE). */
export function formatUkRegistration(registration: string) {
  const key = normalizeRegistrationKey(registration);
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(key)) {
    return `${key.slice(0, 4)} ${key.slice(4)}`;
  }
  return registration.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Guess a plate from an uploaded filename (local mock ANPR). */
export function plateFromFilename(originalName: string): string | null {
  const cleaned = originalName
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned) ? cleaned : null;
}
