import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Dialog, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api, downloadApiFile, secondFactor } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { LoadingScreen } from '../../components/ui';
import { KIND_LABEL, previewSections, type ErasurePreview, type ErasureStatus } from './privacy';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

type Proof = { password: string; code: string };

/** The password and a fresh code, asked before anything that cannot be undone. */
function Confirm({
  submitLabel,
  busyLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  submitLabel: string;
  busyLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (proof: Proof) => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const ready = Boolean(password) && Boolean(code.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending) return;
    onConfirm({ password, code });
    // A code works once, so it is never sent again.
    setCode('');
  }

  return (
    <form className="privacy-confirm" onSubmit={submit}>
      <TextInput type="password" label="Your password" autocomplete="current-password" value={password} onChange={(event) => setPassword(event.detail.value)} />
      <TextInput label="Authenticator code or backup code" autocomplete="one-time-code" value={code} onChange={(event) => setCode(event.detail.value)} />
      {error ? (
        <Alert tone="danger" heading="Nothing was removed">
          {error}
        </Alert>
      ) : null}
      <div className="account-dialog-actions">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" disabled={!ready} busy={pending} busyLabel={busyLabel}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

const proofBody = ({ password, code }: Proof) => ({ password, ...secondFactor(code) });

/** Shows everything the erasure will do before it can be confirmed. */
function EraseDialog({ id, name, onClose, onErased }: { id: string; name: string; onClose: () => void; onErased: (status: ErasureStatus) => void }) {
  const preview = useQuery({
    queryKey: ['erasure-preview', id],
    queryFn: () => api<ErasurePreview>(`/customers/${id}/erasure/preview`),
    // Always read afresh: it must show what would happen now.
    gcTime: 0,
  });
  const [confirming, setConfirming] = useState(false);
  const erase = useMutation({
    mutationFn: (proof: Proof) =>
      api<ErasureStatus>(`/customers/${id}/erasure`, {
        method: 'POST',
        body: JSON.stringify({ confirmation: preview.data?.confirmation, ...proofBody(proof) }),
      }),
    onSuccess: onErased,
    // The records may have changed, so show them as they are now.
    onError: () => void preview.refetch(),
  });
  const blocked = Boolean(preview.data?.openJobs.length);

  return (
    <Dialog open heading={`Erase ${name}`} onClose={onClose}>
      <div className="privacy-dialog">
        {preview.isLoading ? <LoadingScreen label="Working out what would happen…" /> : null}
        {preview.isError ? (
          <Alert tone="danger" heading="The preview could not load">
            {message(preview.error)}
          </Alert>
        ) : null}
        {preview.data && blocked ? (
          <Alert tone="warning" heading="This customer has an open job">
            {`Complete or cancel ${preview.data.openJobs.map((job) => job.reference).join(', ')} first.`}
          </Alert>
        ) : null}
        {preview.data && !blocked && !confirming ? (
          <>
            <Text>This cannot be undone. Export their data first if they asked for a copy.</Text>
            {previewSections(preview.data).map((section) => (
              <section key={section.heading}>
                <Heading level={3} size="sm">
                  {section.heading}
                </Heading>
                <ul className="privacy-list">
                  {section.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            {preview.data.review.length ? (
              <section>
                <Heading level={3} size="sm">
                  Kept and flagged for you to decide
                </Heading>
                <ul className="privacy-list">
                  {preview.data.review.map((item, index) => (
                    <li key={index}>{`${KIND_LABEL[item.kind]}${item.jobReference ? ` on ${item.jobReference}` : ''}. ${item.reason}`}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <Text size="sm" tone="muted">
              A sign-in account is deleted only if nothing outside this record uses it. Backups keep the old data until they expire, and the erasure is applied
              again if a backup is ever restored.
            </Text>
          </>
        ) : null}
        {confirming && !blocked ? (
          <Confirm
            submitLabel="Erase for good"
            busyLabel="Erasing"
            pending={erase.isPending}
            error={erase.isError ? message(erase.error) : null}
            onCancel={onClose}
            onConfirm={(proof) => erase.mutate(proof)}
          />
        ) : (
          <div className="account-dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {preview.data && !blocked ? <Button variant="danger" onClick={() => setConfirming(true)}>{`Continue`}</Button> : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** What was kept at the erasure because it was not clear that it may go. */
function Review({ id, status, onDecided }: { id: string; status: ErasureStatus; onDecided: (status: ErasureStatus) => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: ({ itemId, proof }: { itemId: string; proof?: Proof }) =>
      api<ErasureStatus>(`/customers/${id}/erasure/review/${itemId}`, {
        method: 'POST',
        body: JSON.stringify(proof ? { decision: 'REMOVE', ...proofBody(proof) } : { decision: 'KEEP' }),
      }),
    onSuccess: (next) => {
      setRemoving(null);
      onDecided(next);
    },
  });
  if (!status.reviewItems.length) return null;

  return (
    <div className="privacy-review">
      <Heading level={3} size="sm">
        Records to review
      </Heading>
      <Text size="sm" tone="muted">
        Ask your accountant or lawyer if you are not sure. Open the job to look at a file.
      </Text>
      <ul>
        {status.reviewItems.map((item) => (
          <li key={item.id}>
            <Text size="sm">
              <strong>{KIND_LABEL[item.kind]}</strong>
              {item.jobReference ? ` on ${item.jobReference}` : ''}. {item.reason}
            </Text>
            {item.decision ? (
              <Badge>{item.decision === 'KEPT' ? 'Kept' : 'Removed'}</Badge>
            ) : (
              <div className="privacy-actions">
                {item.importJobId ? (
                  <Button size="sm" variant="ghost" href={`/jobs/${item.importJobId}`}>
                    Open job
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" label={`Keep ${KIND_LABEL[item.kind]}`} onClick={() => decide.mutate({ itemId: item.id })}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  label={`Remove ${KIND_LABEL[item.kind]}`}
                  onClick={() => {
                    decide.reset();
                    setRemoving(item.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {removing ? (
        <Dialog open heading="Remove this record?" onClose={() => setRemoving(null)}>
          <Text>A file is deleted for good. A cost or charge keeps its amount and loses its text.</Text>
          <Confirm
            submitLabel="Remove"
            busyLabel="Removing"
            pending={decide.isPending}
            error={decide.isError ? message(decide.error) : null}
            onCancel={() => setRemoving(null)}
            onConfirm={(proof) => decide.mutate({ itemId: removing, proof })}
          />
        </Dialog>
      ) : decide.isError ? (
        <Alert tone="danger" heading="The decision was not saved">
          {message(decide.error)}
        </Alert>
      ) : null}
    </div>
  );
}

/** For Admins: a customer's right to a copy of their data, and to have it erased. */
export function PrivacyCard({ id, name, erasedAt }: { id: string; name: string; erasedAt: string | null }) {
  const queryClient = useQueryClient();
  const [erasing, setErasing] = useState(false);
  const status = useQuery({
    queryKey: ['erasure', id],
    queryFn: () => api<ErasureStatus>(`/customers/${id}/erasure`),
    enabled: Boolean(erasedAt),
  });
  const download = useMutation({ mutationFn: () => downloadApiFile(`/customers/${id}/export`, `customer-${id}.zip`) });
  const show = (next: ErasureStatus) => queryClient.setQueryData(['erasure', id], next);

  return (
    <Card className="customers-card">
      <Heading level={2} size="md">
        Data and privacy
      </Heading>
      {erasedAt ? (
        <Text size="sm">{`Personal data was erased on ${formatDate(erasedAt)}.`}</Text>
      ) : (
        <Text size="sm">Download a copy of everything held about this customer, or erase it.</Text>
      )}
      {status.data?.filesNotRemoved ? (
        <Alert tone="warning" heading="Some files could not be deleted">
          Contact support, so that they can be removed.
        </Alert>
      ) : null}
      <div className="privacy-actions">
        <Button variant="secondary" iconBefore="download" busy={download.isPending} busyLabel="Preparing the download" onClick={() => download.mutate()}>
          Export data
        </Button>
        {erasedAt ? null : (
          <Button variant="ghost" className="privacy-erase" onClick={() => setErasing(true)}>
            Erase customer
          </Button>
        )}
      </div>
      {download.isError ? (
        <Alert tone="danger" heading="The export did not download">
          {message(download.error)}
        </Alert>
      ) : null}
      {status.data ? <Review id={id} status={status.data} onDecided={show} /> : null}
      {erasing ? (
        <EraseDialog
          id={id}
          name={name}
          onClose={() => setErasing(false)}
          onErased={(next) => {
            setErasing(false);
            show(next);
            void queryClient.invalidateQueries({ queryKey: ['customer', id] });
            void queryClient.invalidateQueries({ queryKey: ['customers'] });
          }}
        />
      ) : null}
    </Card>
  );
}
