import { haversineMeters } from '../dashboard/ops-alerts';

export type CorridorTemplateInput = {
  id: string;
  code: string;
  name: string;
  waypoints: Array<{ latitude: number; longitude: number }>;
};

export type CorridorRecommendation = {
  recommendedTemplateId: string;
  code: string;
  name: string;
  rationale: string;
  confidence: number;
};

function meanDistanceToWaypoints(
  ping: { latitude: number; longitude: number },
  waypoints: Array<{ latitude: number; longitude: number }>,
): number {
  if (waypoints.length === 0) return Number.POSITIVE_INFINITY;
  const total = waypoints.reduce(
    (sum, point) => sum + haversineMeters(ping, point),
    0,
  );
  return total / waypoints.length;
}

function byCode(
  templates: CorridorTemplateInput[],
  fragment: string,
): CorridorTemplateInput | undefined {
  return templates.find((t) => t.code.toUpperCase().includes(fragment));
}

/**
 * Offline corridor pick: prefer the template whose waypoints are closest (on
 * average) to the last real ping. Northern bias when the ping sits nearer the
 * northern corridor; otherwise keep current / central. Never invents GPS.
 */
export function recommendCorridorHeuristic(input: {
  templates: CorridorTemplateInput[];
  currentTemplateId: string | null | undefined;
  lastPing: { latitude: number; longitude: number } | null | undefined;
  status?: string;
}): CorridorRecommendation {
  const { templates } = input;
  if (templates.length === 0) {
    throw new Error('No route templates available');
  }

  const current =
    templates.find((t) => t.id === input.currentTemplateId) ??
    byCode(templates, 'CENTRAL') ??
    templates[0];

  if (!input.lastPing) {
    return {
      recommendedTemplateId: current.id,
      code: current.code,
      name: current.name,
      rationale:
        'No GPS ping yet — keep the current corridor until a tracker reports a real position.',
      confidence: 0.4,
    };
  }

  const ping = input.lastPing;
  const scored = templates
    .map((template) => ({
      template,
      distance: meanDistanceToWaypoints(ping, template.waypoints),
    }))
    .sort((a, b) => a.distance - b.distance);

  const bestEntry = scored[0];
  if (!bestEntry) {
    return {
      recommendedTemplateId: current.id,
      code: current.code,
      name: current.name,
      rationale: `Keep ${current.name} — no corridor scores available.`,
      confidence: 0.4,
    };
  }

  const best = bestEntry.template;
  const northern = byCode(templates, 'NORTHERN');
  const northernScore = northern
    ? scored.find((s) => s.template.id === northern.id)
    : undefined;
  const currentScore = scored.find((s) => s.template.id === current.id);

  // Prefer northern when the ping is clearly closer to that corridor than current.
  const preferNorthern =
    northern &&
    northernScore &&
    currentScore &&
    northern.id !== current.id &&
    northernScore.distance < currentScore.distance * 0.92;

  const pick = preferNorthern ? northern : best;

  // Stick with current when it is already near-best (avoid noisy flips).
  if (
    currentScore &&
    pick.id !== current.id &&
    currentScore.distance <= bestEntry.distance * 1.05 &&
    !preferNorthern
  ) {
    return {
      recommendedTemplateId: current.id,
      code: current.code,
      name: current.name,
      rationale: `Last ping still aligns with ${current.name}; no corridor change needed.`,
      confidence: 0.55,
    };
  }

  if (pick.id === current.id) {
    return {
      recommendedTemplateId: current.id,
      code: current.code,
      name: current.name,
      rationale: `Last ping sits nearest the ${current.name} waypoints — keep this corridor.`,
      confidence: 0.65,
    };
  }

  return {
    recommendedTemplateId: pick.id,
    code: pick.code,
    name: pick.name,
    rationale: preferNorthern
      ? `Last ping is closer to the northern corridor waypoints than ${current.name} — consider switching.`
      : `Last ping averages closer to ${pick.name} waypoints than the current corridor.`,
    confidence: preferNorthern ? 0.72 : 0.68,
  };
}

export function recommendationFromTemplate(
  template: CorridorTemplateInput,
  rationale: string,
  confidence: number,
): CorridorRecommendation {
  return {
    recommendedTemplateId: template.id,
    code: template.code,
    name: template.name,
    rationale,
    confidence,
  };
}

/** Validate a model-picked template id against the assignable list. */
export function pickValidatedRecommendation(
  templates: CorridorTemplateInput[],
  recommendedTemplateId: unknown,
  rationale: unknown,
  confidence: unknown,
): CorridorRecommendation | null {
  if (typeof recommendedTemplateId !== 'string') return null;
  const template = templates.find((t) => t.id === recommendedTemplateId);
  if (!template) return null;
  const text =
    typeof rationale === 'string' && rationale.trim()
      ? rationale.trim().slice(0, 280)
      : `Model suggested ${template.name}.`;
  const conf =
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
      ? confidence
      : 0.7;
  return recommendationFromTemplate(template, text, conf);
}
