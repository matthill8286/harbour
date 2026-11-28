import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  licenceLimit,
  SET_UP_MESSAGES,
  setUpRefusal,
  type Licence,
  type LicenceLimit,
} from './licence';

/** How long an answer is used before asking again. */
export const FRESH_MS = 5 * 60 * 1000;
/** How long "no licence" is believed, so a licence bound by an operator takes effect quickly. */
export const FRESH_MISSING_MS = 60 * 1000;
/** How long the last answer is used while the account service cannot be reached. */
export const STALE_MS = 24 * 60 * 60 * 1000;

const unavailable = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    code: 'licence_unavailable',
    message:
      "Harbour cannot check this workspace's licence right now. Try again shortly.",
  });

/**
 * Reads licences from the Impakt account service, when ACCOUNT_INTERNAL_URL and
 * ACCOUNT_TOKEN are both set. Without them licences are not checked, as in
 * local development.
 *
 * An answer is kept for five minutes. If the account service cannot be reached,
 * the last answer is used for up to a day, so its outage does not lock a
 * workspace out. A workspace it has never answered for is refused until it does.
 */
@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);
  private readonly base: string | null;
  private readonly token: string | null;
  private readonly cache = new Map<
    string,
    { licence: Licence | null; at: number }
  >();
  /** Replaced in tests. */
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (
    url,
    init,
  ) => fetch(url, init);
  now: () => number = () => Date.now();

  constructor(config: ConfigService) {
    const url = config.get<string>('ACCOUNT_INTERNAL_URL') || '';
    const token = config.get<string>('ACCOUNT_TOKEN') || '';
    if (Boolean(url) !== Boolean(token)) {
      throw new Error(
        'Set both ACCOUNT_INTERNAL_URL and ACCOUNT_TOKEN, or neither.',
      );
    }
    this.base = url ? url.replace(/\/$/, '') : null;
    this.token = token || null;
    this.logger.log(
      this.base
        ? 'Licences are checked with the account service, and sign-up needs a licence.'
        : 'Licences are not checked: ACCOUNT_INTERNAL_URL and ACCOUNT_TOKEN are not set.',
    );
  }

  /** False when licences are not checked. */
  get enabled(): boolean {
    return this.base !== null;
  }

  /** The licence covering a workspace, or null when none does. */
  async forWorkspace(organisationId: string): Promise<Licence | null> {
    const now = this.now();
    const cached = this.cache.get(organisationId);
    if (
      cached &&
      now - cached.at < (cached.licence ? FRESH_MS : FRESH_MISSING_MS)
    ) {
      return cached.licence;
    }
    try {
      const licence = await this.read(
        `/internal/licences?tenant=${encodeURIComponent(organisationId)}`,
      );
      this.cache.set(organisationId, { licence, at: now });
      return licence;
    } catch {
      if (cached && now - cached.at < STALE_MS) return cached.licence;
      throw unavailable();
    }
  }

  /** A licence by its id, read fresh, or null. Used before the workspace exists. */
  async byId(id: string): Promise<Licence | null> {
    try {
      return await this.read(`/internal/licences/${encodeURIComponent(id)}`);
    } catch {
      throw unavailable();
    }
  }

  /**
   * The licence a person is setting a workspace up under. Refuses anyone the
   * licence does not name, and a licence that is used or not active.
   */
  async requireSetUp(
    licenceId: string | null | undefined,
    email: string,
  ): Promise<Licence> {
    const licence = licenceId ? await this.byId(licenceId) : null;
    const refusal = setUpRefusal(licence, email);
    if (refusal) {
      throw new ForbiddenException({
        statusCode: 403,
        code: refusal,
        message: SET_UP_MESSAGES[refusal],
      });
    }
    return licence!;
  }

  /** Records the workspace a licence covers. It is set once, and the same workspace again changes nothing. */
  async bind(id: string, organisationId: string): Promise<Licence> {
    let answer: Awaited<ReturnType<LicensingService['call']>>;
    try {
      answer = await this.call(
        `/internal/licences/${encodeURIComponent(id)}/tenant`,
        { tenant: organisationId },
      );
    } catch {
      throw unavailable();
    }
    if (answer.status === 409 || answer.status === 404) {
      throw new ConflictException({
        statusCode: 409,
        code: 'licence_used',
        message: SET_UP_MESSAGES.licence_used,
      });
    }
    if (answer.status !== 200 || !answer.licence) throw unavailable();
    this.cache.set(organisationId, { licence: answer.licence, at: this.now() });
    return answer.licence;
  }

  /**
   * Tells the account service that the workspace a licence covers was deleted.
   * The licence ends there at once and stops naming the workspace. The same
   * call again changes nothing. Throws when the account service does not
   * confirm it, with what it answered.
   */
  async release(id: string, organisationId: string): Promise<Licence> {
    this.cache.delete(organisationId);
    let answer: Awaited<ReturnType<LicensingService['call']>>;
    try {
      answer = await this.call(
        `/internal/licences/${encodeURIComponent(id)}/release`,
        { tenant: organisationId },
      );
    } catch (error) {
      throw new Error(
        `The account service could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (answer.status !== 200 || !answer.licence) {
      throw new Error(
        `The account service answered ${answer.status}${answer.code ? ` (${answer.code})` : ''}.`,
      );
    }
    return answer.licence;
  }

  /** The licence's own ceiling for a plan limit, or null when it sets none or licences are not checked. */
  async limit(
    organisationId: string,
    limit: LicenceLimit,
  ): Promise<number | null> {
    if (!this.enabled) return null;
    return licenceLimit(await this.forWorkspace(organisationId), limit);
  }

  private async call(path: string, body?: unknown) {
    const response = await this.fetcher(`${this.base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    const json = (await response.json().catch(() => ({}))) as {
      licence?: Licence;
      code?: string;
    };
    return {
      status: response.status,
      licence: json.licence ?? null,
      code: typeof json.code === 'string' ? json.code : null,
    };
  }

  /** The licence, null for 404, or a thrown error for anything that is not an answer. */
  private async read(path: string): Promise<Licence | null> {
    const answer = await this.call(path);
    if (answer.status === 404) return null;
    if (answer.status !== 200 || !answer.licence) {
      throw new Error(`Account service answered ${answer.status}`);
    }
    return answer.licence;
  }
}
