import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Dialog, FileUpload, Heading, Row, SegmentedControl, Select, Text } from '@atomic-ui/ui-react';
import type { ImpaktFileUpload } from '@atomic-ui/ui';
import { DOCUMENT_TYPES, PHOTO_CATEGORIES } from '@vip/shared';
import { api, downloadApiFile } from '../../lib/api';
import { formatBytes, formatCategory, formatDate } from '../../lib/format';
import { AuthenticatedImage } from '../../components/AuthenticatedImage';
import { useJobStatus } from './useJobStatus';
import type { JobDetail } from './types';
import './FilesTab.css';

type Kind = 'photos' | 'documents';

const KIND_OPTIONS = [
  { value: 'photos', label: 'Photo' },
  { value: 'documents', label: 'Document' },
];
const VISIBILITY_OPTIONS = [
  { value: 'internal', label: 'Internal' },
  { value: 'customer', label: 'Customer' },
];
const PHOTO_OPTIONS = PHOTO_CATEGORIES.map((value) => ({ value, label: formatCategory(value) }));
const DOCUMENT_OPTIONS = DOCUMENT_TYPES.map((value) => ({ value, label: formatCategory(value) }));
const ACCEPT: Record<Kind, string> = {
  // The extensions are for browsers that do not know the HEIC types.
  photos: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif',
  documents: 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif',
};

/** The short file kind shown on a document, from its type: PDF, JPG, PNG. */
const fileKind = (mimeType: string) => (mimeType.split('/')[1] ?? 'file').replace('jpeg', 'jpg').slice(0, 4).toUpperCase();
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The Files tab, after the Figma frames "Job workspace · Files": an upload card,
 * the photos and the documents. Everything is internal until it is marked
 * visible, and only visible files appear in the customer portal.
 */
export function FilesTab({ job }: { job: JobDetail }) {
  const { editable } = useJobStatus(job);
  const queryClient = useQueryClient();
  const picker = useRef<ImpaktFileUpload>(null);
  const [kind, setKind] = useState<Kind>('photos');
  const [category, setCategory] = useState<string>('COLLECTION');
  const [visible, setVisible] = useState(false);
  const [chosen, setChosen] = useState<File[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['job', job.id] });

  const upload = useMutation({
    mutationFn: async () => {
      for (const file of chosen) {
        const body = new FormData();
        body.append('file', file);
        body.append(kind === 'photos' ? 'category' : 'type', category);
        body.append('customerVisible', String(visible));
        await api(`/import-jobs/${job.id}/${kind}`, { method: 'POST', body });
      }
    },
    onSuccess: async () => {
      setChosen([]);
      if (picker.current) picker.current.files = [];
      await refresh();
    },
  });

  const share = useMutation({
    mutationFn: ({ kind, id, customerVisible }: { kind: Kind; id: string; customerVisible: boolean }) =>
      api(`/import-jobs/${job.id}/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify({ customerVisible }) }),
    onSuccess: refresh,
  });

  const download = useMutation({
    mutationFn: (doc: JobDetail['documents'][number]) => downloadApiFile(`/import-jobs/${job.id}/documents/${doc.id}`, doc.name),
  });

  const [doomed, setDoomed] = useState<{ kind: Kind; id: string; name: string; customerVisible: boolean } | null>(null);
  const remove = useMutation({
    mutationFn: ({ kind, id }: { kind: Kind; id: string }) => api(`/import-jobs/${job.id}/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      setDoomed(null);
    },
  });
  const askToDelete = (target: NonNullable<typeof doomed>) => {
    remove.reset();
    setDoomed(target);
  };

  const visiblePhotos = job.photos.filter((p) => p.customerVisible).length;
  const shareLabel = (on: boolean, name: string) => (on ? `Hide ${name} from the customer` : `Share ${name} with the customer`);

  return (
    <div className="job-files">
      {editable ? (
        <Card className="job-card">
          <Heading level={2} size="md">
            Upload
          </Heading>
          <Text size="sm" tone="muted">
            Uploads are internal by default. Only items marked visible appear in the customer portal.
          </Text>
          <form
            className="job-upload"
            onSubmit={(event) => {
              event.preventDefault();
              if (chosen.length) upload.mutate();
            }}
          >
            <FileUpload
              ref={picker}
              className="job-upload-drop"
              label="Files"
              accept={ACCEPT[kind]}
              manyFiles
              dropText="Drop photos or documents here, or browse"
              onFiles={(e) => setChosen(e.detail.files)}
            />
            <SegmentedControl
              label="Type"
              options={KIND_OPTIONS}
              value={kind}
              onChange={(e) => {
                const next = e.detail.value as Kind;
                setKind(next);
                setCategory(next === 'photos' ? 'COLLECTION' : 'OTHER');
              }}
            />
            <Select
              label={kind === 'photos' ? 'Photo category' : 'Document type'}
              options={kind === 'photos' ? PHOTO_OPTIONS : DOCUMENT_OPTIONS}
              value={category}
              onChange={(e) => setCategory(e.detail.value)}
            />
            <SegmentedControl
              label="Visibility"
              options={VISIBILITY_OPTIONS}
              value={visible ? 'customer' : 'internal'}
              onChange={(e) => setVisible(e.detail.value === 'customer')}
            />
            <Button type="submit" disabled={chosen.length === 0} busy={upload.isPending} busyLabel="Uploading">
              {chosen.length > 1 ? `Upload ${chosen.length}` : 'Upload'}
            </Button>
          </form>
          {upload.isError ? (
            <Alert tone="danger" heading="The upload did not finish">
              {upload.error instanceof Error ? upload.error.message : 'Try again.'}
            </Alert>
          ) : null}
        </Card>
      ) : null}

      {share.isError || download.isError ? (
        <Alert tone="danger" heading={share.isError ? 'Sharing did not change' : 'The document did not download'}>
          {(share.error ?? download.error) instanceof Error ? (share.error ?? download.error)!.message : 'Try again.'}
        </Alert>
      ) : null}

      <div className="job-files-grid">
        <Card className="job-card">
          <div className="job-card-head">
            <Heading level={2} size="md">
              Photos
            </Heading>
            <Text size="sm" tone="muted">{`${count(job.photos.length, 'photo')} · ${visiblePhotos} visible to customer`}</Text>
          </div>
          {job.photos.length === 0 ? (
            <Text tone="muted">No photos yet. Collection, mileage and VIN photos go here.</Text>
          ) : (
            <ul className="job-photos">
              {job.photos.map((photo) => (
                <li key={photo.id} className="job-photo">
                  <AuthenticatedImage
                    path={`/import-jobs/${job.id}/photos/${photo.id}?size=thumb`}
                    alt={`${formatCategory(photo.category)} photo, ${photo.filename}`}
                    className="job-photo-image"
                  />
                  <span className="job-photo-top">
                    <Badge>{formatCategory(photo.category)}</Badge>
                  </span>
                  <span className="job-photo-bottom">
                    {photo.customerVisible ? <Badge tone="solid">Visible to customer</Badge> : <Badge>Internal</Badge>}
                    <span className="job-photo-actions">
                      {editable ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={photo.customerVisible ? 'lock' : 'eye'}
                          label={shareLabel(photo.customerVisible, `the ${formatCategory(photo.category).toLowerCase()} photo`)}
                          onClick={() => share.mutate({ kind: 'photos', id: photo.id, customerVisible: !photo.customerVisible })}
                        />
                      ) : null}
                      {editable ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="trash"
                          label={`Delete ${photo.filename}`}
                          onClick={() => askToDelete({ kind: 'photos', id: photo.id, name: photo.filename, customerVisible: photo.customerVisible })}
                        />
                      ) : null}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="job-card">
          <div className="job-card-head">
            <div>
              <Heading level={2} size="md">
                Documents
              </Heading>
              <Text size="sm" tone="muted">
                V5C, invoices, transport
              </Text>
            </div>
            <Text size="sm" tone="muted">
              {count(job.documents.length, 'document')}
            </Text>
          </div>
          {job.documents.length === 0 ? (
            <Text tone="muted">No documents yet. The V5C, invoices and transport papers go here.</Text>
          ) : (
            <div role="list">
              {job.documents.map((doc) => (
                <Row
                  key={doc.id}
                  role="listitem"
                  heading={doc.name}
                  meta={`${formatCategory(doc.type)} · ${formatBytes(doc.sizeBytes)} · ${formatDate(doc.createdAt)}`}
                >
                  <span slot="start" className="job-doc-kind" aria-hidden="true">
                    {fileKind(doc.mimeType)}
                  </span>
                  <span slot="end" className="job-doc-end">
                    {doc.customerVisible ? <Badge tone="solid">Visible to customer</Badge> : <Badge>Internal</Badge>}
                    {editable ? (
                      <Button size="sm" variant="ghost" onClick={() => share.mutate({ kind: 'documents', id: doc.id, customerVisible: !doc.customerVisible })}>
                        {doc.customerVisible ? 'Hide' : 'Share'}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" icon="download" label={`Download ${doc.name}`} onClick={() => download.mutate(doc)} />
                    {editable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        label={`Delete ${doc.name}`}
                        onClick={() => askToDelete({ kind: 'documents', id: doc.id, name: doc.name, customerVisible: doc.customerVisible })}
                      />
                    ) : null}
                  </span>
                </Row>
              ))}
            </div>
          )}
        </Card>
      </div>

      {doomed ? (
        <Dialog open heading={doomed.kind === 'photos' ? 'Delete this photo?' : 'Delete this document?'} onClose={() => setDoomed(null)}>
          <div className="job-dialog">
            <Text>
              <strong className="job-file-name">{doomed.name}</strong> will be deleted for good.
              {doomed.customerVisible ? ' The customer will no longer see it.' : ''} This cannot be undone.
            </Text>
            {remove.isError ? (
              <Alert tone="danger" heading="It was not deleted">
                {remove.error instanceof Error ? remove.error.message : 'Try again.'}
              </Alert>
            ) : null}
            <div className="job-dialog-actions">
              <Button variant="secondary" onClick={() => setDoomed(null)}>
                Cancel
              </Button>
              <Button variant="danger" busy={remove.isPending} busyLabel="Deleting" onClick={() => remove.mutate(doomed)}>
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
