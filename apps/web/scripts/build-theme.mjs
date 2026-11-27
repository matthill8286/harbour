#!/usr/bin/env node
/**
 * Write Harbour's design tokens as a stylesheet.
 *
 *   node scripts/build-theme.mjs
 *
 * The brand inputs in src/theme/harbour-brand.json are the Figma "Harbour"
 * variables in the Signal orange mode. @atomic-ui/design-tokens derives every
 * token from them, raising any colour that would miss WCAG 2.2 AA, and this
 * writes the result to src/theme/harbour-tokens.css, which the app imports.
 * The stylesheet is committed, so the app needs no derivation at run time;
 * src/theme/theme.spec.ts fails when it no longer matches the inputs.
 *
 * Warning, success and info are placeholders until the Figma file defines them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harbourStylesheet } from '../src/theme/stylesheet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const inputs = JSON.parse(readFileSync(join(here, '../src/theme/harbour-brand.json'), 'utf8'));
writeFileSync(join(here, '../src/theme/harbour-tokens.css'), harbourStylesheet(inputs));
console.log('Wrote src/theme/harbour-tokens.css');
