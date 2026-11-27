import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Dialog, EmptyState, Heading, MoneyInput, Select, Text, TextInput } from '@atomic-ui/ui-react';
import { CHARGE_CATEGORIES, COST_CATEGORIES, moneyLineProblem, type MoneyLineKind } from '@vip/shared';
import { api } from '../../lib/api';
import { formatCategory, money } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { JobDetail } from './types';
import './MoneyTab.css';

type Line = JobDetail['costs'][number];
type Draft = { category: string; description: string; amount: string };

const OPTIONS: Record<MoneyLineKind, { value: string; label: string }[]> = {
  cost: COST_CATEGORIES.map((value) => ({ value, label: formatCategory(value) })),
  charge: CHARGE_CATEGORIES.map((value) => ({ value, label: formatCategory(value) })),
};
const PATH: Record<MoneyLineKind, string> = { cost: 'costs', charge: 'charges' };
const WORD: Record<MoneyLineKind, string> = { cost: 'cost', charge: 'charge' };

/** The problem with a draft line, or null, by the rule the API applies too. */
function draftProblem(draft: Draft) {
  if (draft.amount.trim() === '') return 'Enter an amount.';
  return moneyLineProblem({ category: draft.category, description: draft.description, amount: Number(draft.amount) });
}

/** The line's description, or its category when it has none. */
const lineName = (line: Line) => line.description || formatCategory(line.category);

/** A form for a money line, used to add one and to edit one. */
function LineFields({ kind, draft, onChange, tried, currency }: { kind: MoneyLineKind; draft: Draft; onChange: (patch: Partial<Draft>) => void; tried: boolean; currency: string }) {
  const problem = tried ? draftProblem(draft) : null;
  const other = draft.category === 'OTHER';
  return (
    <>
      <Select label="Category" options={OPTIONS[kind]} value={draft.category} onChange={(e) => onChange({ category: e.detail.value })} />
      <TextInput
        label={other ? 'Description' : 'Description (optional)'}
        required={other}
        value={draft.description}
        error={problem && other && !draft.description.trim() ? 'Say what this is. A description is needed when the category is Other.' : ''}
        onChange={(e) => onChange({ description: e.detail.value })}
      />
      <MoneyInput
        label="Amount"
        currency={currency}
        pence
        value={draft.amount}
        error={problem && !(other && !draft.description.trim()) ? problem : ''}
        onChange={(e) => onChange({ amount: e.detail.value })}
      />
    </>
  );
}

/**
 * The Money tab, after the Figma frames "Job workspace · Money": the totals, the
 * cost lines and the customer charge lines. Lines can be added, edited and
 * deleted, on a closed job too, so the books can be put right after delivery.
 * Every change is written to Activity, and none of it reaches the customer.
 */
export function MoneyTab({ job }: { job: JobDetail }) {
  const { canWrite, currency } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ kind: MoneyLineKind; line: Line } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: MoneyLineKind; line: Line } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['job', job.id] });
  const empty = job.costs.length === 0 && job.charges.length === 0;

  return (
    <div className="job-money">
      <dl className="job-money-totals">
        <div>
          <dt>Internal cost</dt>
          <dd>{money(job.totals.totalCost, currency)}</dd>
          <Text size="sm" tone="muted">Sum of the cost lines below</Text>
        </div>
        <div>
          <dt>Customer charges</dt>
          <dd>{money(job.totals.totalCharge, currency)}</dd>
          <Text size="sm" tone="muted">Sum of the charge lines below</Text>
        </div>
        <div className="is-margin">
          <dt>
            Gross margin <Badge icon="lock">Internal only</Badge>
          </dt>
          <dd>{money(job.totals.margin, currency)}</dd>
          <span className="job-money-hint">Customer charges − internal cost</span>
        </div>
      </dl>

      {empty && !canWrite ? <EmptyState heading="No costs or charges yet" lead="Lines appear here once the team adds them." framed /> : null}

      <div className="job-money-grid">
        <MoneyCard kind="cost" title="Costs" lead="What this job costs the business" lines={job.costs} job={job} currency={currency} canWrite={canWrite} onEdit={setEditing} onDelete={setDeleting} onAdded={refresh} />
        <MoneyCard kind="charge" title="Customer charges" lead="What the customer is invoiced" lines={job.charges} job={job} currency={currency} canWrite={canWrite} onEdit={setEditing} onDelete={setDeleting} onAdded={refresh} />
      </div>

      <Text size="sm" tone="muted">
        Costs, charges and margin are internal and never shown in the customer portal. Every change is written to Activity.
      </Text>

      {editing ? <EditLineDialog jobId={job.id} currency={currency} {...editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteLineDialog jobId={job.id} currency={currency} {...deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

function MoneyCard({
  kind,
  title,
  lead,
  lines,
  job,
  currency,
  canWrite,
  onEdit,
  onDelete,
  onAdded,
}: {
  kind: MoneyLineKind;
  title: string;
  lead: string;
  lines: Line[];
  job: JobDetail;
  currency: string;
  canWrite: boolean;
  onEdit: (v: { kind: MoneyLineKind; line: Line }) => void;
  onDelete: (v: { kind: MoneyLineKind; line: Line }) => void;
  onAdded: () => Promise<unknown>;
}) {
  const blank: Draft = { category: 'TRANSPORT', description: '', amount: '' };
  const [draft, setDraft] = useState<Draft>(blank);
  const [tried, setTried] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${job.id}/${PATH[kind]}`, {
        method: 'POST',
        body: JSON.stringify({ category: draft.category, description: draft.description.trim() || undefined, amount: Number(draft.amount) }),
      }),
    onSuccess: async () => {
      setDraft(blank);
      setTried(false);
      await onAdded();
    },
  });

  return (
    <Card className="job-card">
      <Heading level={2} size="md">
        {title}
      </Heading>
      <Text size="sm" tone="muted">
        {lead}
      </Text>
      {lines.length === 0 ? (
        <Text tone="muted" className="job-money-none">{`No ${WORD[kind]}s yet.`}</Text>
      ) : (
        <ul className="job-money-lines">
          {lines.map((line) => (
            <li key={line.id}>
              <Badge>{formatCategory(line.category)}</Badge>
              <span className="job-money-desc">{line.description || '—'}</span>
              <strong className="job-money-amount">{money(line.amount, currency)}</strong>
              {canWrite ? (
                <span className="job-money-actions">
                  <Button size="sm" variant="ghost" icon="pencil" label={`Edit ${lineName(line)}`} onClick={() => onEdit({ kind, line })} />
                  <Button size="sm" variant="ghost" icon="trash" label={`Delete ${lineName(line)}`} onClick={() => onDelete({ kind, line })} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form
          className="job-money-add"
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (!draftProblem(draft)) add.mutate();
          }}
        >
          <LineFields kind={kind} draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} tried={tried} currency={currency} />
          <Button type="submit" variant="subtle" busy={add.isPending} busyLabel={`Adding the ${WORD[kind]}`}>
            {`Add ${WORD[kind]}`}
          </Button>
        </form>
      ) : null}
      {add.isError ? (
        <Alert tone="danger" heading={`The ${WORD[kind]} was not added`}>
          {add.error instanceof Error ? add.error.message : 'Try again.'}
        </Alert>
      ) : null}
    </Card>
  );
}

/** Edit a money line, after the Figma dialog "Edit cost line". */
function EditLineDialog({ jobId, kind, line, currency, onClose }: { jobId: string; kind: MoneyLineKind; line: Line; currency: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({ category: line.category, description: line.description, amount: String(Number(line.amount)) });
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${jobId}/${PATH[kind]}/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ category: draft.category, description: draft.description.trim(), amount: Number(draft.amount) }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      onClose();
    },
  });

  return (
    <Dialog open heading={`Edit ${WORD[kind]} line`} onClose={onClose}>
      <form
        className="job-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!draftProblem(draft)) save.mutate();
        }}
      >
        <LineFields kind={kind} draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} tried={tried} currency={currency} />
        <p className="job-dialog-lead">The change is written to Activity with what the line was before.</p>
        {save.isError ? (
          <Alert tone="danger" heading="The line was not saved">
            {save.error instanceof Error ? save.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending} busyLabel="Saving the line">
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Delete a money line, after the Figma dialog "Delete money line". */
function DeleteLineDialog({ jobId, kind, line, currency, onClose }: { jobId: string; kind: MoneyLineKind; line: Line; currency: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/import-jobs/${jobId}/${PATH[kind]}/${line.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      onClose();
    },
  });

  return (
    <Dialog open heading={`Delete this ${WORD[kind]}?`} onClose={onClose}>
      <div className="job-dialog">
        <p className="job-dialog-lead">{`${lineName(line)}, ${money(line.amount, currency)}, comes off the job and the totals change. The deletion is written to Activity.`}</p>
        {remove.isError ? (
          <Alert tone="danger" heading="The line was not deleted">
            {remove.error instanceof Error ? remove.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" busy={remove.isPending} busyLabel="Deleting the line" onClick={() => remove.mutate()}>
            {`Delete ${WORD[kind]}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
