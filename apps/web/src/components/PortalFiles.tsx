import { useEffect, useState } from 'react';
import { downloadApiFile } from '../lib/api';
import { formatBytes, formatCategory, formatDateTime } from '../lib/format';
import { AuthenticatedImage } from './AuthenticatedImage';
import { Card, secondaryBtn } from './ui';

export type PortalPhoto = {
  id: string;
  filename: string;
  category: string;
  mimeType: string;
  createdAt: string;
};

export type PortalDocument = {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export function PortalFiles({
  jobId,
  photos,
  documents,
}: {
  jobId: string;
  photos: PortalPhoto[];
  documents: PortalDocument[];
}) {
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const openPhoto = photos.find((photo) => photo.id === openPhotoId) ?? null;

  useEffect(() => {
    if (!openPhoto) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenPhotoId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPhoto]);

  return (
    <>
      <Card>
        <h2 className="display text-2xl">Photos</h2>
        <p className="text-xs text-ink/45">Condition and collection photos shared with you.</p>
        {photos.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">No photos have been shared yet. They will appear here when your importer releases them.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                className="overflow-hidden rounded-xl bg-sand text-left"
                onClick={() => setOpenPhotoId(photo.id)}
              >
                <AuthenticatedImage
                  path={`/portal/jobs/${jobId}/photos/${photo.id}`}
                  alt={photo.filename}
                  className="aspect-square w-full object-cover"
                />
                <span className="block px-2 py-1.5 text-[11px] text-ink/60">{formatCategory(photo.category)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="display text-2xl">Documents</h2>
        <p className="text-xs text-ink/45">Paperwork your importer has chosen to share. Internal invoices stay off this list.</p>
        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">No documents have been shared yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 rounded-xl bg-sand/70 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold">{doc.name}</p>
                  <p className="text-xs text-ink/50">
                    {formatCategory(doc.type)} · {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => void downloadApiFile(`/portal/jobs/${jobId}/documents/${doc.id}`, doc.name)}
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {openPhoto ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={openPhoto.filename}
          onClick={() => setOpenPhotoId(null)}
        >
          <div
            className="max-h-[90svh] w-full max-w-3xl overflow-hidden rounded-2xl bg-paper p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <AuthenticatedImage
              path={`/portal/jobs/${jobId}/photos/${openPhoto.id}`}
              alt={openPhoto.filename}
              className="max-h-[70svh] w-full rounded-xl object-contain bg-sand"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-semibold">{formatCategory(openPhoto.category)}</span>
                <span className="block text-xs text-ink/50">{formatDateTime(openPhoto.createdAt)}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => void downloadApiFile(`/portal/jobs/${jobId}/photos/${openPhoto.id}`, openPhoto.filename)}
                >
                  Download
                </button>
                <button type="button" className={secondaryBtn} onClick={() => setOpenPhotoId(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
