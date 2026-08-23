import { DOCUMENT_TYPES, PHOTO_CATEGORIES, JOURNEY_STATUSES, JOURNEY_TYPES } from '@vip/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, downloadApiFile } from '../lib/api';
import { formatBytes, formatCategory, formatDateTime } from '../lib/format';
import { AuthenticatedImage } from './AuthenticatedImage';
import { Card, ErrorBanner, fieldClass, secondaryBtn } from './ui';

type Photo = {
  id: string;
  filename: string;
  category: string;
  mimeType: string;
  customerVisible: boolean;
  createdAt: string;
};

type DocumentFile = {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  customerVisible: boolean;
  createdAt: string;
};

type Journey = {
  id: string;
  type: string;
  origin: string;
  destination: string;
  status: string;
};

export function JobJourneys({
  jobId,
  journeys,
}: {
  jobId: string;
  journeys: Journey[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ origin: '', destination: '', type: 'ROAD', status: 'PLANNED' });
  const create = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${jobId}/journeys`, {
        method: 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      setForm({ origin: '', destination: '', type: 'ROAD', status: 'PLANNED' });
      void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    },
  });

  return (
    <Card>
      <h2 className="display text-2xl">Journeys</h2>
      <p className="text-xs text-ink/45">Road and ferry legs for this import. Separate from GPS pings.</p>
      <ol className="mt-4 space-y-3">
        {journeys.map((journey, index) => (
          <li key={journey.id} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">
              {index + 1}
            </span>
            <div>
              <p className="font-semibold">
                {journey.origin} → {journey.destination}
              </p>
              <p className="text-xs text-ink/50">
                {formatCategory(journey.type)} · {formatCategory(journey.status)}
              </p>
            </div>
          </li>
        ))}
        {journeys.length === 0 ? <li className="text-sm text-ink/50">No legs recorded yet.</li> : null}
      </ol>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input className={fieldClass} placeholder="Origin" value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} />
        <input className={fieldClass} placeholder="Destination" value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} />
        <select className={fieldClass} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          {JOURNEY_TYPES.map((item) => (
            <option key={item} value={item}>
              {formatCategory(item)}
            </option>
          ))}
        </select>
        <select className={fieldClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
          {JOURNEY_STATUSES.map((item) => (
            <option key={item} value={item}>
              {formatCategory(item)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${secondaryBtn} sm:col-span-2`}
          disabled={!form.origin || !form.destination || create.isPending}
          onClick={() => create.mutate()}
        >
          Add journey leg
        </button>
      </div>
    </Card>
  );
}

export function JobFilesPanel({
  jobId,
  photos,
  documents,
}: {
  jobId: string;
  photos: Photo[];
  documents: DocumentFile[];
}) {
  const queryClient = useQueryClient();
  const [photoMeta, setPhotoMeta] = useState({ category: 'COLLECTION', customerVisible: false });
  const [docMeta, setDocMeta] = useState({ type: 'OTHER', customerVisible: false });
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job', jobId] });

  async function setVisibility(kind: 'photos' | 'documents', fileId: string, customerVisible: boolean) {
    setError(null);
    try {
      await api(`/import-jobs/${jobId}/${kind}/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ customerVisible }),
      });
      await invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update sharing');
    }
  }

  async function upload(kind: 'photos' | 'documents', file: File, extra: Record<string, string>) {
    setError(null);
    const body = new FormData();
    body.append('file', file);
    Object.entries(extra).forEach(([key, value]) => body.append(key, value));
    try {
      await api(`/import-jobs/${jobId}/${kind}`, { method: 'POST', body });
      await invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorBanner message={error} /> : null}
      <section className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="display text-2xl">Photos</h2>
        <p className="text-xs text-ink/45">Condition, VIN, mileage. Mark customer-visible to share in the portal.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo) => (
            <figure key={photo.id} className="overflow-hidden rounded-xl bg-sand">
              <AuthenticatedImage
                path={`/import-jobs/${jobId}/photos/${photo.id}`}
                alt={photo.filename}
                className="aspect-square w-full object-cover"
              />
              <figcaption className="space-y-1 px-2 py-1.5 text-[11px] text-ink/60">
                <p>
                  {formatCategory(photo.category)}
                  {photo.customerVisible ? ' · customer' : ' · internal'}
                </p>
                <button
                  type="button"
                  className="font-semibold text-harbour"
                  onClick={() =>
                    void setVisibility('photos', photo.id, !photo.customerVisible)
                  }
                >
                  {photo.customerVisible ? 'Hide from customer' : 'Share with customer'}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
        {photos.length === 0 ? <p className="mt-3 text-sm text-ink/50">No photos yet.</p> : null}
        <div className="mt-4 grid gap-2">
          <select className={fieldClass} value={photoMeta.category} onChange={(event) => setPhotoMeta({ ...photoMeta, category: event.target.value })}>
            {PHOTO_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {formatCategory(item)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-harbour"
              checked={photoMeta.customerVisible}
              onChange={(event) => setPhotoMeta({ ...photoMeta, customerVisible: event.target.checked })}
            />
            Visible to customer
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void upload('photos', file, {
                  category: photoMeta.category,
                  customerVisible: String(photoMeta.customerVisible),
                });
                event.target.value = '';
              }
            }}
          />
        </div>
      </Card>
      <Card>
        <h2 className="display text-2xl">Documents</h2>
        <p className="text-xs text-ink/45">V5C, invoices, transport. Internal unless marked visible.</p>
        <ul className="mt-3 space-y-2 text-sm">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 rounded-xl bg-sand/70 px-3 py-2">
              <div>
                <p className="font-semibold">{doc.name}</p>
                <p className="text-xs text-ink/50">
                  {formatCategory(doc.type)} · {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                  {doc.customerVisible ? ' · customer' : ' · internal'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => void downloadApiFile(`/import-jobs/${jobId}/documents/${doc.id}`, doc.name)}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-harbour"
                  onClick={() => void setVisibility('documents', doc.id, !doc.customerVisible)}
                >
                  {doc.customerVisible ? 'Hide from customer' : 'Share with customer'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {documents.length === 0 ? <p className="mt-3 text-sm text-ink/50">No documents yet.</p> : null}
        <div className="mt-4 grid gap-2">
          <select className={fieldClass} value={docMeta.type} onChange={(event) => setDocMeta({ ...docMeta, type: event.target.value })}>
            {DOCUMENT_TYPES.map((item) => (
              <option key={item} value={item}>
                {formatCategory(item)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-harbour"
              checked={docMeta.customerVisible}
              onChange={(event) => setDocMeta({ ...docMeta, customerVisible: event.target.checked })}
            />
            Visible to customer
          </label>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void upload('documents', file, {
                  type: docMeta.type,
                  customerVisible: String(docMeta.customerVisible),
                });
                event.target.value = '';
              }
            }}
          />
        </div>
      </Card>
    </section>
    </div>
  );
}
