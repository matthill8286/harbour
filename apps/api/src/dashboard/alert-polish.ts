import { applyTriagePolish, type EnrichedOpsAlert } from './ops-alert-triage';

export const POLISH_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 2000;

type Entry = { at: number; summary?: string };

/**
 * Keeps the optional model's wording for GPS alerts, so the Board never waits
 * for it. A load shows what is already known and asks for the rest in the
 * background; a later load shows the answer. An alert is asked about at most
 * once in each period, whether the model answers, fails or is still thinking.
 * It is held in memory: after a restart the model is asked again.
 */
export class AlertPolish {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  apply(
    organisationId: string,
    alerts: EnrichedOpsAlert[],
    ask: (alerts: EnrichedOpsAlert[]) => Promise<unknown>,
  ): EnrichedOpsAlert[] {
    const now = this.now();
    const keyOf = (alert: EnrichedOpsAlert) =>
      JSON.stringify([
        organisationId,
        alert.kind,
        alert.importJobId,
        alert.trackerSerial ?? '',
      ]);
    const wanted = alerts.filter((alert) => {
      const entry = this.entries.get(keyOf(alert));
      return !entry || now - entry.at >= POLISH_TTL_MS;
    });
    const shown = alerts.map((alert) => {
      const summary = this.entries.get(keyOf(alert))?.summary;
      return summary ? { ...alert, aiSummary: summary } : alert;
    });
    if (wanted.length === 0) return shown;

    for (const alert of wanted) {
      const key = keyOf(alert);
      this.remember(key, { ...this.entries.get(key), at: now });
    }
    void Promise.resolve()
      .then(() => ask(wanted))
      .then((answer) => {
        for (const [index, alert] of applyTriagePolish(
          wanted,
          answer,
        ).entries()) {
          if (alert === wanted[index]) continue;
          this.remember(keyOf(alert), { at: now, summary: alert.aiSummary });
        }
      })
      .catch(this.onError);
    return shown;
  }

  /** The oldest entries go first, so the memory used stays bounded. */
  private remember(key: string, entry: Entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(oldest);
    }
  }
}
