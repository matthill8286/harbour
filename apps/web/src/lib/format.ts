export function money(value: number | string, currency = 'EUR') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(value));
}

export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatCategory(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function relativeTime(value: string | null) {
  if (!value) return 'No ping yet';
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.round(Math.abs(delta) / 60000);
  const suffix = delta >= 0 ? 'ago' : 'from now';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ${suffix}`;
  return `${Math.round(hours / 24)} days ${suffix}`;
}
