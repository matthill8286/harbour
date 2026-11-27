import { useEffect, useRef, useState } from 'react';
import { Button } from '@atomic-ui/ui-react';
import { downloadApiFile } from '../../lib/api';
import { formatCategory, formatDate } from '../../lib/format';
import { AuthenticatedImage } from '../../components/AuthenticatedImage';
import type { PortalPhoto } from './portal';

/**
 * Shared photos full screen, after the Figma frame "My vehicle · Photo viewer".
 * A native modal dialog, so focus stays inside and Escape closes it; the arrow
 * keys move between photos.
 */
export function PhotoViewer({ jobId, photos, start, onClose }: { jobId: string; photos: PortalPhoto[]; start: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(start);
  const photo = photos[at];
  const go = (step: number) => setAt((current) => (current + step + photos.length) % photos.length);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  if (!photo) return null;
  const path = (id: string) => `/portal/jobs/${jobId}/photos/${id}`;

  return (
    <dialog
      ref={ref}
      className="portal-viewer"
      aria-label={`Photo ${at + 1} of ${photos.length}`}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(1);
        if (event.key === 'ArrowLeft') go(-1);
      }}
    >
      <div className="portal-viewer-head">
        <div>
          <strong>{formatCategory(photo.category)}</strong>
          <small>{`Photo ${at + 1} of ${photos.length} · shared ${formatDate(photo.createdAt)}`}</small>
        </div>
        <div className="portal-viewer-actions">
          <Button variant="secondary" icon="download" label="Download this photo" onClick={() => void downloadApiFile(path(photo.id), photo.filename)} />
          <Button variant="secondary" icon="close" label="Close" onClick={() => ref.current?.close()} />
        </div>
      </div>
      <div className="portal-viewer-stage">
        {photos.length > 1 ? (
          <Button variant="secondary" icon="arrow-left" label="Previous photo" className="portal-viewer-prev" onClick={() => go(-1)} />
        ) : null}
        <AuthenticatedImage key={photo.id} path={path(photo.id)} alt={formatCategory(photo.category)} className="portal-viewer-image" />
        {photos.length > 1 ? <Button variant="secondary" icon="arrow-right" label="Next photo" className="portal-viewer-next" onClick={() => go(1)} /> : null}
      </div>
      {photos.length > 1 ? (
        <ol className="portal-viewer-thumbs" aria-label="All photos">
          {photos.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={`Photo ${index + 1}, ${formatCategory(item.category)}`}
                aria-current={index === at ? 'true' : undefined}
                onClick={() => setAt(index)}
              >
                <AuthenticatedImage path={`${path(item.id)}?size=thumb`} alt="" className="portal-viewer-thumb" />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </dialog>
  );
}
