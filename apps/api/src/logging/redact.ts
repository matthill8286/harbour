/**
 * Keeps personal data and secrets out of the logs. Every line the logger writes
 * goes through here, including lines from code that did not think about it.
 */

const MAX_TEXT = 1000;
const MAX_FRAMES = 20;

const RULES: ReadonlyArray<[RegExp, string]> = [
  // A password in a connection string.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+@/gi, '$1[redacted]@'],
  // Invite, sign-up and reset links. A route pattern such as `/:token` stays.
  [
    /\/(invites?|reset-password|signup\/confirm|password\/reset)\/(?!:)[^\s/?#"'`<>]+/gi,
    '/$1/[redacted]',
  ],
  [
    /([?&](?:token|access_token|api_key|key|secret|code|data)=)[^&\s"'`<>]+/gi,
    '$1[redacted]',
  ],
  [/\b(Bearer|FlespiToken|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]'],
  [/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // A GPS unit's IMEI.
  [/\b\d{15}\b/g, '[imei]'],
  // Anything else long enough to be a token or a key.
  [/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{32,}/g, '[redacted]'],
];

export function redact(text: string): string {
  let clean = text;
  // Prisma's messages quote the query, with the names and addresses in it.
  const query = /Invalid `[^`]*` invocation/.exec(clean);
  if (query) clean = `${clean.slice(0, query.index)}${query[0]}`;
  for (const [pattern, replacement] of RULES) {
    clean = clean.replace(pattern, replacement);
  }
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}…` : clean;
}

/** Only the `at …` lines: the lines above them repeat the message. */
export function stackFrames(stack: string | undefined): string[] {
  return (stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => redact(line.trim()));
}

export type ErrorDetails = {
  name: string;
  code?: string;
  model?: string;
  message?: string;
  cause?: string;
  stack?: string[];
};

/** What may be written down about an error. */
export function describeError(error: unknown): ErrorDetails {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: redact(String(error)) };
  }
  const { code, meta, cause } = error as Error & {
    code?: unknown;
    meta?: { modelName?: unknown };
    cause?: { code?: unknown };
  };
  const prisma = error.constructor.name.startsWith('PrismaClient');
  return {
    name: prisma ? error.constructor.name : error.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof meta?.modelName === 'string' ? { model: meta.modelName } : {}),
    // A Prisma message can hold anything that was in the query.
    ...(prisma ? {} : { message: redact(error.message) }),
    ...(typeof cause?.code === 'string' ? { cause: cause.code } : {}),
    stack: stackFrames(error.stack),
  };
}
