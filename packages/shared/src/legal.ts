/**
 * The agreements a workspace accepts to use Harbour, and the sub-processors
 * IMPKT uses to run it. The API and the web app read the same list, so both
 * agree on which versions are current.
 *
 * PLACEHOLDERS. The titles, versions and sub-processor details below are not
 * legal text. A solicitor must supply the wording of each document and confirm
 * the sub-processor list before any client relies on it. Publishing a new
 * wording means giving it a new version here, which asks every workspace to
 * accept it again.
 */

export const LEGAL_DOCUMENT_KEYS = [
  'TERMS_OF_SERVICE',
  'DATA_PROCESSING_AGREEMENT',
  'ACCEPTABLE_USE_POLICY',
] as const;
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

export type LegalDocument = {
  key: LegalDocumentKey;
  title: string;
  /** Changes whenever the wording changes. */
  version: string;
  /** Where the full text is published, or null until it is. */
  url: string | null;
};

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    key: 'TERMS_OF_SERVICE',
    title: 'Harbour terms of service (placeholder)',
    version: '0.1-placeholder',
    url: null,
  },
  {
    key: 'DATA_PROCESSING_AGREEMENT',
    title: 'Data processing agreement (placeholder)',
    version: '0.1-placeholder',
    url: null,
  },
  {
    key: 'ACCEPTABLE_USE_POLICY',
    title: 'Acceptable use policy (placeholder)',
    version: '0.1-placeholder',
    url: null,
  },
];

/** The version of each document that is current now. */
export function currentLegalVersions(): Record<LegalDocumentKey, string> {
  return Object.fromEntries(
    LEGAL_DOCUMENTS.map((document) => [document.key, document.version]),
  ) as Record<LegalDocumentKey, string>;
}

/** The documents whose current version is not among those accepted. */
export function outstandingLegalDocuments(
  accepted: ReadonlyArray<{ document: string; version: string }>,
): LegalDocument[] {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      !accepted.some(
        (item) =>
          item.document === document.key && item.version === document.version,
      ),
  );
}

export type SubProcessor = {
  name: string;
  /** What IMPKT uses it for, and so what data it sees. */
  purpose: string;
  /** Where it processes the data. */
  location: string;
};

/** Changes whenever the list changes, so the record says which list was shown. */
export const SUB_PROCESSORS_VERSION = '0.1-placeholder';

/** PLACEHOLDER: a solicitor must confirm each entry, its location and its terms. */
export const SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    name: 'Server hosting provider',
    purpose: 'Runs Harbour and stores the workspace database and files.',
    location: 'To be confirmed',
  },
  {
    name: 'Flespi (Gurtam)',
    purpose: 'Receives and decodes the positions sent by GPS trackers.',
    location: 'To be confirmed',
  },
  {
    name: 'Email delivery provider (Resend or Brevo)',
    purpose: 'Sends sign-in, invite and notification emails.',
    location: 'To be confirmed',
  },
  {
    name: 'Map tile provider (OpenStreetMap or Mapbox)',
    purpose: 'Supplies the map images shown behind tracked positions.',
    location: 'To be confirmed',
  },
  {
    name: 'OpenAI',
    purpose:
      'Drafts customer updates, triage notes and route suggestions from job details when staff ask for them.',
    location: 'To be confirmed',
  },
  {
    name: 'Plate Recognizer',
    purpose: 'Reads number plates from photos when a workspace uses it.',
    location: 'To be confirmed',
  },
];
