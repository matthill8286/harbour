import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dialog, SegmentedControl, Select, TextInput, Textarea } from '@atomic-ui/ui-react';
import { JOURNEY_STATUSES, JOURNEY_TYPES, TASK_PRIORITIES, type TaskPriority } from '@vip/shared';
import { api } from '../../lib/api';
import { formatCategory } from '../../lib/format';

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((value) => ({ value, label: formatCategory(value) }));
const TYPE_OPTIONS = JOURNEY_TYPES.map((value) => ({ value, label: formatCategory(value) }));
const LEG_STATUS_OPTIONS = JOURNEY_STATUSES.filter((s) => s !== 'CANCELLED').map((value) => ({ value, label: formatCategory(value) }));

export type TaskDraft = { id?: string; title: string; priority: TaskPriority; dueDate: string };

/** The buttons at the foot of a dialog: the way out first, the action last. */
function Actions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="job-dialog-actions">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      {children}
    </div>
  );
}

function failure(error: unknown) {
  return error instanceof Error ? error.message : 'Try again.';
}

/**
 * Add a task, or edit one when `task.id` is set, after the Figma dialog "Add task".
 * A new task goes to the end of the checklist; the order never reshuffles.
 */
export function TaskDialog({ jobId, task, onClose }: { jobId: string; task: TaskDraft; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(task);
  const editing = Boolean(task.id);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api(`/import-jobs/${jobId}/tasks/${task.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: draft.title.trim(), priority: draft.priority, dueDate: draft.dueDate || null }),
          })
        : api(`/import-jobs/${jobId}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ title: draft.title.trim(), priority: draft.priority, ...(draft.dueDate ? { dueDate: draft.dueDate } : {}) }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      onClose();
    },
  });

  return (
    <Dialog open heading={editing ? 'Edit task' : 'Add a task'} onClose={onClose}>
      <form
        className="job-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.title.trim()) save.mutate();
        }}
      >
        <TextInput
          label="Title"
          required
          value={draft.title}
          onChange={(e) => {
            const value = e.detail.value;
            setDraft((d) => ({ ...d, title: value }));
          }}
        />
        <SegmentedControl
          label="Priority"
          full
          options={PRIORITY_OPTIONS}
          value={draft.priority}
          onChange={(e) => {
            const value = e.detail.value as TaskPriority;
            setDraft((d) => ({ ...d, priority: value }));
          }}
        />
        <TextInput
          label="Due date (optional)"
          type="date"
          value={draft.dueDate}
          onChange={(e) => {
            const value = e.detail.value;
            setDraft((d) => ({ ...d, dueDate: value }));
          }}
        />
        {save.isError ? (
          <Alert tone="danger" heading="The task was not saved">
            {failure(save.error)}
          </Alert>
        ) : null}
        <Actions onCancel={onClose}>
          <Button type="submit" disabled={!draft.title.trim()} busy={save.isPending} busyLabel="Saving the task">
            Save task
          </Button>
        </Actions>
      </form>
    </Dialog>
  );
}

/** Add a road or ferry leg, after the Figma dialog "Add journey leg". The new leg goes last. */
export function AddLegDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [leg, setLeg] = useState({ origin: '', destination: '', type: 'ROAD', status: 'PLANNED' });
  const ready = Boolean(leg.origin.trim() && leg.destination.trim());
  const save = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${jobId}/journeys`, {
        method: 'POST',
        body: JSON.stringify({ ...leg, origin: leg.origin.trim(), destination: leg.destination.trim() }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      onClose();
    },
  });
  const set = (key: keyof typeof leg) => (e: CustomEvent<{ value: string }>) => {
    const value = e.detail.value;
    setLeg((l) => ({ ...l, [key]: value }));
  };

  return (
    <Dialog open heading="Add a journey leg" onClose={onClose}>
      <form
        className="job-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <div className="job-dialog-pair">
          <TextInput label="Origin" required value={leg.origin} onChange={set('origin')} />
          <TextInput label="Destination" required value={leg.destination} onChange={set('destination')} />
        </div>
        <SegmentedControl label="Type" full options={TYPE_OPTIONS} value={leg.type} onChange={set('type')} />
        <Select label="Status" options={LEG_STATUS_OPTIONS} value={leg.status} onChange={set('status')} />
        {save.isError ? (
          <Alert tone="danger" heading="The leg was not added">
            {failure(save.error)}
          </Alert>
        ) : null}
        <Actions onCancel={onClose}>
          <Button type="submit" disabled={!ready} busy={save.isPending} busyLabel="Adding the leg">
            Add leg
          </Button>
        </Actions>
      </form>
    </Dialog>
  );
}

/**
 * Cancel the job, after the Figma dialog "Cancel job". Cancelling is final, so the
 * dialog says so and asks for the reason, which is kept with the status change.
 */
export function CancelJobDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${jobId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'CANCELLED', ...(reason.trim() ? { note: reason.trim() } : {}) }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      onClose();
    },
  });

  return (
    <Dialog open heading="Cancel this job?" onClose={onClose}>
      <form
        className="job-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          cancel.mutate();
        }}
      >
        <p className="job-dialog-lead">The customer is told by email if they have an address on file. You can still open the job afterwards, but it cannot be moved again.</p>
        <Textarea
          label="Reason (optional)"
          rows={3}
          value={reason}
          onChange={(e) => {
            const value = e.detail.value;
            setReason(value);
          }}
        />
        {cancel.isError ? (
          <Alert tone="danger" heading="The job was not cancelled">
            {failure(cancel.error)}
          </Alert>
        ) : null}
        <div className="job-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Keep job
          </Button>
          <Button type="submit" variant="danger" busy={cancel.isPending} busyLabel="Cancelling the job">
            Cancel job
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
