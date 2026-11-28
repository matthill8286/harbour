import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Heading, Text } from '@atomic-ui/ui-react';
import type { LegalDocument, SubProcessor } from '@vip/shared';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useAcceptTerms, useTerms, type TermsStatus } from '../lib/terms';
import { LoadingScreen } from './ui';
import './Agreements.css';

/** The documents, each with its version and a link once the text is published. */
export function AgreementList({ documents }: { documents: readonly LegalDocument[] }) {
  return (
    <ul className="agreements-list">
      {documents.map((document) => (
        <li key={document.key}>
          <Text>
            <strong>
              {document.url ? (
                <a href={document.url} target="_blank" rel="noreferrer">
                  {document.title}
                </a>
              ) : (
                document.title
              )}
            </strong>
          </Text>
          <Text size="sm" tone="muted">
            Version {document.version}
            {document.url ? '' : ' · The full text is still to be published.'}
          </Text>
        </li>
      ))}
    </ul>
  );
}

export function SubProcessorList({ items }: { items: readonly SubProcessor[] }) {
  return (
    <ul className="agreements-list">
      {items.map((item) => (
        <li key={item.name}>
          <Text>
            <strong>{item.name}</strong>
          </Text>
          <Text size="sm" tone="muted">
            {item.purpose} Location: {item.location}.
          </Text>
        </li>
      ))}
    </ul>
  );
}

/**
 * Shown to an Admin, in place of the workspace, until the current version of
 * every agreement is accepted.
 */
export function AcceptAgreements({ status, workspace }: { status: TermsStatus; workspace: string }) {
  const accept = useAcceptTerms();
  const terms = useTerms();
  const [agreed, setAgreed] = useState(false);
  const changed = accept.error instanceof ApiError && accept.error.code === 'terms_changed';
  const renewal = status.documents.some((document) => document.accepted);

  return (
    <Card className="agreements-gate">
      <Heading level={1} size="2xl">
        {renewal ? 'The Harbour agreements have changed' : 'Accept the Harbour agreements'}
      </Heading>
      <Text tone="muted">
        {renewal
          ? `A new version of at least one agreement needs to be accepted before ${workspace} can carry on using Harbour.`
          : `An Admin accepts these for ${workspace} before the workspace is used.`}{' '}
        You accept them for the business, which is the controller of the data it puts into Harbour.
      </Text>
      <AgreementList documents={status.documents} />
      <Heading level={2} size="sm">
        Sub-processors
      </Heading>
      <Text size="sm" tone="muted">
        IMPKT uses these providers to run Harbour.
      </Text>
      <SubProcessorList items={status.subProcessors} />
      <Checkbox
        label={`I accept these agreements on behalf of ${workspace}, and I am authorised to do so`}
        checked={agreed}
        onChange={(event) => setAgreed(Boolean(event.detail.value))}
      />
      {accept.isError ? (
        <Alert tone="danger" heading={changed ? 'The agreements have changed' : 'That did not work'}>
          {accept.error.message}
          {changed ? (
            <div className="job-retry">
              <Button variant="secondary" onClick={() => void terms.refetch().then(() => accept.reset())}>
                Show the current versions
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}
      <div>
        <Button disabled={!agreed} busy={accept.isPending} busyLabel="Recording your acceptance" onClick={() => accept.mutate(status)}>
          Accept and continue
        </Button>
      </div>
    </Card>
  );
}

/** What a member who is not an Admin sees while agreements wait for acceptance. */
export function AgreementsPending() {
  return (
    <Alert tone="warning" heading="Updated agreements are waiting">
      An Admin of this workspace needs to accept the updated Harbour agreements.
    </Alert>
  );
}

/** The Workspace page's record of what was accepted, and the sub-processors. */
export function AgreementsCard() {
  const terms = useTerms();
  const status = terms.data;
  return (
    <Card className="account-card">
      <Heading level={2} size="md">
        Agreements and sub-processors
      </Heading>
      {terms.isLoading ? (
        <LoadingScreen label="Loading the agreements…" />
      ) : !status ? (
        <Alert tone="danger" heading="The agreements could not load">
          Check your connection, then try again.
        </Alert>
      ) : (
        <>
          <ul className="agreements-list">
            {status.documents.map((document) => (
              <li key={document.key}>
                <div className="agreements-row">
                  <Text>
                    <strong>{document.title}</strong>
                  </Text>
                  <Badge tone={document.accepted?.current ? 'solid' : 'neutral'}>{document.accepted?.current ? 'Accepted' : 'Not accepted'}</Badge>
                </div>
                <Text size="sm" tone="muted">
                  Current version {document.version}
                  {document.accepted
                    ? ` · Version ${document.accepted.version} accepted ${formatDateTime(document.accepted.acceptedAt)}${
                        document.accepted.acceptedBy ? ` by ${document.accepted.acceptedBy}` : ''
                      }`
                    : ''}
                </Text>
              </li>
            ))}
          </ul>
          <Heading level={3} size="sm">
            Sub-processors
          </Heading>
          <Text size="sm" tone="muted">
            List version {status.subProcessorsVersion}.
          </Text>
          <SubProcessorList items={status.subProcessors} />
        </>
      )}
    </Card>
  );
}
