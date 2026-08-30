import {
  recommendCorridorHeuristic,
  pickValidatedRecommendation,
} from './corridor-recommend';

const central = {
  id: 'tpl-central',
  code: 'UK_BG_GR_CENTRAL',
  name: 'Central',
  waypoints: [
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 50.85, longitude: 4.35 },
    { latitude: 48.2, longitude: 16.37 },
    { latitude: 42.7, longitude: 23.32 },
    { latitude: 34.7, longitude: 33.02 },
  ],
};

const northern = {
  id: 'tpl-northern',
  code: 'UK_BG_GR_NORTHERN',
  name: 'Northern',
  waypoints: [
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 52.52, longitude: 13.405 },
    { latitude: 50.08, longitude: 14.44 },
    { latitude: 42.7, longitude: 23.32 },
    { latitude: 34.7, longitude: 33.02 },
  ],
};

const southern = {
  id: 'tpl-southern',
  code: 'UK_BG_GR_SOUTHERN',
  name: 'Southern',
  waypoints: [
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 45.46, longitude: 9.19 },
    { latitude: 45.81, longitude: 15.98 },
    { latitude: 42.7, longitude: 23.32 },
    { latitude: 34.7, longitude: 33.02 },
  ],
};

const templates = [central, northern, southern];

describe('recommendCorridorHeuristic', () => {
  it('keeps current when there is no GPS ping', () => {
    const result = recommendCorridorHeuristic({
      templates,
      currentTemplateId: central.id,
      lastPing: null,
    });
    expect(result.recommendedTemplateId).toBe(central.id);
    expect(result.rationale).toMatch(/No GPS ping/i);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('prefers northern when last ping is near Berlin', () => {
    const result = recommendCorridorHeuristic({
      templates,
      currentTemplateId: central.id,
      lastPing: { latitude: 52.52, longitude: 13.405 },
    });
    expect(result.recommendedTemplateId).toBe(northern.id);
    expect(result.code).toContain('NORTHERN');
    expect(result.rationale.length).toBeGreaterThan(10);
  });

  it('keeps central when ping sits on the central corridor', () => {
    const result = recommendCorridorHeuristic({
      templates,
      currentTemplateId: central.id,
      lastPing: { latitude: 50.85, longitude: 4.35 },
    });
    expect(result.recommendedTemplateId).toBe(central.id);
  });

  it('defaults to central when current template is missing and no ping', () => {
    const result = recommendCorridorHeuristic({
      templates,
      currentTemplateId: null,
      lastPing: null,
    });
    expect(result.recommendedTemplateId).toBe(central.id);
  });
});

describe('pickValidatedRecommendation', () => {
  it('accepts a known template id', () => {
    expect(
      pickValidatedRecommendation(templates, northern.id, 'Switch north', 0.8),
    ).toEqual({
      recommendedTemplateId: northern.id,
      code: northern.code,
      name: northern.name,
      rationale: 'Switch north',
      confidence: 0.8,
    });
  });

  it('rejects unknown ids', () => {
    expect(pickValidatedRecommendation(templates, 'nope', 'x', 0.9)).toBeNull();
  });
});
