import {
  applyTriagePolish,
  enrichOpsAlertHeuristic,
  enrichOpsAlertsHeuristic,
} from './ops-alert-triage';
import type { OpsAlert } from './ops-alerts';

describe('enrichOpsAlertHeuristic', () => {
  it('adds why/next copy for stale trackers', () => {
    const alert: OpsAlert = {
      kind: 'STALE_TRACKER',
      importJobId: 'job-1',
      reference: 'CY-1',
      title: 'Tracker quiet',
      detail: 'TAT-1 has not reported recently on CY-1',
      trackerSerial: 'TAT-1',
    };
    const enriched = enrichOpsAlertHeuristic(alert);
    expect(enriched.detail).toMatch(/no live position/i);
    expect(enriched.aiSummary).toMatch(/Why it matters/i);
    expect(enriched.aiSummary).toMatch(/Next:/i);
    expect(enriched.aiSummary).toMatch(/Tracking/i);
  });

  it('adds why/next copy for near-destination alerts', () => {
    const alert: OpsAlert = {
      kind: 'NEAR_DESTINATION',
      importJobId: 'job-2',
      reference: 'CY-2',
      title: 'Near destination',
      detail: 'CY-2 is ~1.2 km from Limassol — status not yet arrived',
    };
    const enriched = enrichOpsAlertHeuristic(alert);
    expect(enriched.detail).toMatch(/Prep arrival/i);
    expect(enriched.aiSummary).toMatch(/Why it matters/i);
    expect(enriched.aiSummary).toMatch(/Next:/i);
  });
});

describe('enrichOpsAlertsHeuristic / applyTriagePolish', () => {
  it('maps a list and applies validated polish only', () => {
    const base = enrichOpsAlertsHeuristic([
      {
        kind: 'STALE_TRACKER',
        importJobId: 'job-1',
        reference: 'CY-1',
        title: 'Tracker quiet',
        detail: 'quiet',
        trackerSerial: 'TAT-1',
      },
    ]);
    const polished = applyTriagePolish(base, {
      summaries: [
        {
          kind: 'STALE_TRACKER',
          importJobId: 'job-1',
          aiSummary: 'Polished staff note.',
        },
        { kind: 'STALE_TRACKER', importJobId: 'other', aiSummary: 'ignore' },
      ],
    });
    expect(polished[0]?.aiSummary).toBe('Polished staff note.');
  });

  it('ignores malformed polish payloads', () => {
    const base = enrichOpsAlertsHeuristic([
      {
        kind: 'NEAR_DESTINATION',
        importJobId: 'job-2',
        reference: 'CY-2',
        title: 'Near destination',
        detail: 'near',
      },
    ]);
    expect(applyTriagePolish(base, null)[0]?.aiSummary).toMatch(
      /Why it matters/i,
    );
    expect(
      applyTriagePolish(base, { summaries: 'nope' })[0]?.aiSummary,
    ).toMatch(/Why it matters/i);
  });
});
