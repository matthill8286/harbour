import type { OpsAlert } from './ops-alerts';

export type EnrichedOpsAlert = OpsAlert & {
  /** Staff-only one-liner: why it matters + suggested next step. */
  aiSummary?: string;
};

/**
 * Offline triage copy for Board GPS alerts. Never emails customers.
 */
export function enrichOpsAlertHeuristic(alert: OpsAlert): EnrichedOpsAlert {
  if (alert.kind === 'STALE_TRACKER') {
    const serial = alert.trackerSerial ?? 'tracker';
    return {
      ...alert,
      detail: `${alert.detail} — ops has no live position for this consignment.`,
      aiSummary: `Why it matters: ${serial} went quiet, so Board cannot trust ETA. Next: open Tracking, pull/sync or replace the unit, then confirm the trail resumes.`,
    };
  }

  if (alert.kind === 'NEAR_DESTINATION') {
    return {
      ...alert,
      detail: `${alert.detail}. Prep arrival handling before status catches up.`,
      aiSummary:
        'Why it matters: vehicle is near the destination but status is not arrived yet — clearance/dock work may start. Next: open Tracking, confirm the ping, then advance status when ready.',
    };
  }

  return { ...alert };
}

export function enrichOpsAlertsHeuristic(
  alerts: OpsAlert[],
): EnrichedOpsAlert[] {
  return alerts.map(enrichOpsAlertHeuristic);
}

/** Merge optional model polish onto heuristic alerts (ids must match). */
export function applyTriagePolish(
  alerts: EnrichedOpsAlert[],
  polish: unknown,
): EnrichedOpsAlert[] {
  if (!polish || typeof polish !== 'object') return alerts;
  const summaries = (polish as { summaries?: unknown }).summaries;
  if (!Array.isArray(summaries)) return alerts;

  const byKey = new Map<string, string>();
  for (const item of summaries) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.importJobId !== 'string' || typeof row.kind !== 'string') {
      continue;
    }
    if (typeof row.aiSummary !== 'string' || !row.aiSummary.trim()) continue;
    byKey.set(
      `${row.kind}:${row.importJobId}`,
      row.aiSummary.trim().slice(0, 320),
    );
  }

  return alerts.map((alert) => {
    const polished = byKey.get(`${alert.kind}:${alert.importJobId}`);
    return polished ? { ...alert, aiSummary: polished } : alert;
  });
}
