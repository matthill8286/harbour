import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NOTE_VISIBILITIES } from '@vip/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Card, ErrorBanner, fieldClass, primaryBtn, secondaryBtn } from '../../components/ui';
import type { JobDetail } from './types';

/** The Notes tab, moved out of the job page as it was. It is redesigned in its own change. */
export function NotesTab({ job }: { job: JobDetail }) {
  const { canWrite } = useSession();
  const queryClient = useQueryClient();
  const id = job.id;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job', id] });
  const [note, setNote] = useState({ body: '', visibility: 'INTERNAL' });
  const [draftIntent, setDraftIntent] = useState('');
  const [draftTone, setDraftTone] = useState('professional');
  const [draftSource, setDraftSource] = useState<'log' | 'openai' | null>(null);
  const noteMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/notes`, { method: 'POST', body: JSON.stringify(note) }),
    onSuccess: () => {
      setNote({ body: '', visibility: 'INTERNAL' });
      setDraftSource(null);
      void invalidate();
    },
  });
  const draftNoteMutation = useMutation({
    mutationFn: () =>
      api<{ draft: string; source: 'log' | 'openai' }>(`/import-jobs/${id}/draft-customer-note`, {
        method: 'POST',
        body: JSON.stringify({
          intent: draftIntent.trim() || note.body.trim(),
          tone: draftTone,
        }),
      }),
    onSuccess: (result) => {
      setNote((prev) => ({
        ...prev,
        body: result.draft,
        visibility: 'CUSTOMER',
      }));
      setDraftSource(result.source);
    },
  });

  return (
    <Card>
      <h2 className="font-semibold">Notes</h2>
      <ul className="mt-3 space-y-3 text-sm">
        {job.notes.map((item) => (
          <li key={item.id} className="rounded-xl bg-sand/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink/45">
              {item.visibility === 'CUSTOMER' ? 'Visible to customer' : 'Internal only'} ·{' '}
              {item.author.name}
            </p>
            <p className="mt-1">{item.body}</p>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <>
          <div className="mt-4 grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${fieldClass} min-w-[12rem] flex-1`}
                value={draftIntent}
                onChange={(event) => setDraftIntent(event.target.value)}
                placeholder="Intent for AI draft (e.g. ferry delayed overnight)"
              />
              <select
                className={`${fieldClass} w-auto`}
                aria-label="Draft tone"
                value={draftTone}
                onChange={(event) => setDraftTone(event.target.value)}
              >
                <option value="professional">Professional</option>
                <option value="warm">Warm</option>
                <option value="brief">Brief</option>
              </select>
              <button
                type="button"
                className={secondaryBtn}
                disabled={
                  draftNoteMutation.isPending ||
                  !(draftIntent.trim() || note.body.trim())
                }
                onClick={() => draftNoteMutation.mutate()}
              >
                {draftNoteMutation.isPending ? 'Drafting…' : 'Draft with AI'}
              </button>
              {draftSource ? (
                <span className="text-xs font-semibold uppercase tracking-widest text-ink/45">
                  Source: {draftSource}
                </span>
              ) : null}
            </div>
            {draftNoteMutation.isError ? (
              <ErrorBanner
                message={
                  draftNoteMutation.error instanceof Error
                    ? draftNoteMutation.error.message
                    : 'Could not draft note'
                }
              />
            ) : null}
            <p className="text-xs text-ink/45">
              AI fills the text below — review it, then click Add note. Nothing is posted or emailed until you save.
            </p>
          </div>
          <textarea
            className={`${fieldClass} mt-2 min-h-24`}
            value={note.body}
            onChange={(event) => {
              setNote({ ...note, body: event.target.value });
              setDraftSource(null);
            }}
            placeholder="Write an update"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              className={fieldClass}
              value={note.visibility}
              onChange={(event) => setNote({ ...note, visibility: event.target.value })}
            >
              {NOTE_VISIBILITIES.map((item) => (
                <option key={item} value={item}>
                  {item === 'CUSTOMER' ? 'Visible to customer' : 'Internal only'}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => noteMutation.mutate()}
              disabled={!note.body.trim()}
            >
              Add note
            </button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
