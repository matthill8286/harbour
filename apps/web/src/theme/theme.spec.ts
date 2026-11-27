import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@atomic-ui/design-tokens';
import { harbourStylesheet } from './stylesheet.mjs';
import inputs from './harbour-brand.json';

const committed = readFileSync(join(__dirname, 'harbour-tokens.css'), 'utf8');
const token = (name: string) => new RegExp(`--impakt-${name}:\\s*([^;]+);`).exec(committed)?.[1]?.trim() ?? '';

describe('Harbour theme', () => {
  it('matches the brand inputs; run node scripts/build-theme.mjs after changing them', () => {
    expect(committed).toBe(harbourStylesheet(inputs));
  });

  it('keeps the Signal orange the Figma file uses', () => {
    expect(token('color-brand-default').toUpperCase()).toBe('#B24424');
  });

  it('reads every text colour at 4.5:1 on the page and the card', () => {
    for (const text of ['color-text-default', 'color-text-muted', 'color-text-placeholder']) {
      for (const surface of ['#F2F5F4', '#FFFFFF']) {
        expect(contrastRatio(token(text), surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastRatio(token('color-text-on-brand'), token('color-brand-default'))).toBeGreaterThanOrEqual(4.5);
  });
});
