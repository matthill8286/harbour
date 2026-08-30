export type CustomerNoteDraftContext = {
  reference: string;
  statusLabel: string;
  vehicleSummary: string;
  intent: string;
  tone?: string;
};

/** Deterministic customer-visible draft for AI_PROVIDER=log (no network). */
export function buildCustomerNoteDraft(ctx: CustomerNoteDraftContext): string {
  const intent = ctx.intent.trim().replace(/\s+/g, ' ');
  const tone = ctx.tone?.trim().toLowerCase();
  const greeting =
    tone === 'warm' ? 'Hope you are well —' : tone === 'brief' ? '' : 'Hello,';

  const vehicleBit = ctx.vehicleSummary.trim()
    ? ` regarding your ${ctx.vehicleSummary.trim()}`
    : '';
  const statusBit = `The current status for job ${ctx.reference} is ${ctx.statusLabel}.`;
  const intentBit = intent
    ? ` ${intent.replace(/\.*$/, '')}.`
    : ' We will share a further update shortly.';

  const opener = greeting
    ? `${greeting} a quick update${vehicleBit}.`
    : `Quick update${vehicleBit}.`;

  return `${opener} ${statusBit}${intentBit} Please reply if you have any questions.`.replace(
    /\s+/g,
    ' ',
  );
}

export function vehicleSummaryFromParts(parts: {
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  ukRegistration?: string | null;
}): string {
  const name = [parts.make, parts.model, parts.variant]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  const reg = parts.ukRegistration?.trim();
  if (name && reg) return `${name} (${reg})`;
  return name || reg || '';
}
