import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, EmptyState, Heading, SegmentedControl, Select, Text, Textarea, TextInput } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { JobDetail } from './types';
import './NotesTab.css';

const VISIBILITY = [
  { value: 'INTERNAL', label: 'Internal' },
  { value: 'CUSTOMER', label: 'Visible to customer' },
];
const TONES = [
  { value: 'professional', label: 'Tone: Professional' },
  { value: 'warm', label: 'Tone: Warm' },
  { value: 'brief', label: 'Tone: Brief' },
];

/**
 * The Notes tab, after the Figma frames "Job workspace · Notes": a note to write,
 * with a draft for the customer that the AI can start from, and the notes so far,
 * newest first. A note visible to the customer is emailed to them.
 */
export function NotesTab({ job }: { job: JobDetail }) {
  const { canWrite } = useSession();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('INTERNAL');
  const [intent, setIntent] = useState('');
  const [tone, setTone] = useState('professional');
  const [source, setSource] = useState<'log' | 'openai' | null>(null);

  const save = useMutation({
    mutationFn: () => api(`/import-jobs/${job.id}/notes`, { method: 'POST', body: JSON.stringify({ body: body.trim(), visibility }) }),
    onSuccess: async () => {
      setBody('');
      setIntent('');
      setSource(null);
      setVisibility('INTERNAL');
      await queryClient.invalidateQueries({ queryKey: ['job', job.id] });
    },
  });
  const draft = useMutation({
    mutationFn: () =>
      api<{ draft: string; source: 'log' | 'openai' }>(`/import-jobs/${job.id}/draft-customer-note`, {
        method: 'POST',
        body: JSON.stringify({ intent: intent.trim() || body.trim(), tone }),
      }),
    onSuccess: (result) => {
      setBody(result.draft);
      setVisibility('CUSTOMER');
      setSource(result.source);
    },
  });

  const notes = [...job.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visibleCount = notes.filter((n) => n.visibility === 'CUSTOMER').length;

  return (
    <div className={`job-notes${canWrite ? '' : ' is-read-only'}`}>
      {canWrite ? (
        <Card className="job-card">
          <form
            className="job-notes-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (body.trim()) save.mutate();
            }}
          >
            <Textarea
              label="Write an update"
              rows={5}
              value={body}
              onChange={(e) => {
                const value = e.detail.value;
                setBody(value);
                setSource(null);
              }}
            />
            <SegmentedControl label="Who can see this" options={VISIBILITY} value={visibility} onChange={(e) => setVisibility(e.detail.value)} />
            <fieldset className="job-notes-draft">
              <legend>Draft a customer update</legend>
              <TextInput label="What happened?" placeholder="For example, ferry delayed overnight" value={intent} onChange={(e) => setIntent(e.detail.value)} />
              <div className="job-notes-draft-row">
                <Select label="Tone" options={TONES} value={tone} onChange={(e) => setTone(e.detail.value)} />
                <Button
                  variant="subtle"
                  disabled={!(intent.trim() || body.trim())}
                  busy={draft.isPending}
                  busyLabel="Drafting the update"
                  onClick={() => draft.mutate()}
                >
                  Draft
                </Button>
              </div>
              <Text size="sm" tone="muted">
                {source
                  ? `Drafted ${source === 'openai' ? 'by AI' : "from the job's history"}. Read it through before saving; nothing is sent until you save.`
                  : 'The draft fills the update above. Nothing is sent until you save.'}
              </Text>
            </fieldset>
            {draft.isError || save.isError ? (
              <Alert tone="danger" heading={draft.isError ? 'No draft was written' : 'The note was not saved'}>
                {(draft.error ?? save.error) instanceof Error ? (draft.error ?? save.error)!.message : 'Try again.'}
              </Alert>
            ) : null}
            <div className="job-notes-foot">
              <Text size="sm" tone="muted">
                Customer-visible notes are emailed to the customer.
              </Text>
              <Button type="submit" disabled={!body.trim()} busy={save.isPending} busyLabel="Saving the note">
                Save note
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="job-card">
        <div className="job-card-head">
          <Heading level={2} size="md">
            Notes
          </Heading>
          <Text size="sm" tone="muted">{`${notes.length} ${notes.length === 1 ? 'note' : 'notes'} · ${visibleCount} visible to customer`}</Text>
        </div>
        {notes.length === 0 ? (
          <EmptyState heading="No notes yet" lead="Internal notes stay with the team. Notes visible to the customer are emailed to them and shown in their portal." />
        ) : (
          <ol className="job-notes-list">
            {notes.map((note) => (
              <li key={note.id} className={note.visibility === 'CUSTOMER' ? 'is-shared' : ''}>
                <div className="job-notes-head">
                  <Text size="sm">{`${note.author.name} · ${formatDate(note.createdAt)}`}</Text>
                  {note.visibility === 'CUSTOMER' ? <Badge tone="solid">Visible to customer</Badge> : <Badge>Internal</Badge>}
                </div>
                <p>{note.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
