import { useState } from 'react';
import { Alert, Button, Dialog, Icon, RadioGroup, Select, Switch, Text, TextInput } from '@atomic-ui/ui-react';
import type { WorkflowStageDef } from '@vip/shared';
import { COUNTRY_CODES, countryName } from '../job/countries';
import { jobsInStage, routeApi, routeLabel, routeName, stagesWord, statusesWord, useRouteChange, type RouteSummary, type StageInput } from './routes';
import { useReorder } from './useReorder';

const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) }));
const failure = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

type Draft = { key: number; code?: string; label: string };
let nextKey = 0;
const draft = (status: { code?: string; label: string }): Draft => ({ key: nextKey++, ...status });

/** Add a stage, or edit one: its name, whether the customer sees it, and its statuses in order. */
export function StageDialog({ route, stage, onClose }: { route: RouteSummary; stage: WorkflowStageDef | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: stage?.name ?? '',
    customerName: stage?.customerName ?? '',
    customerVisible: stage?.customerVisible ?? true,
  });
  const [statuses, setStatuses] = useState<Draft[]>(() => (stage ? stage.statuses.map(draft) : [draft({ label: '' })]));
  const [tried, setTried] = useState(false);
  const save = useRouteChange((body: StageInput) => routeApi.saveStage(route.id, stage?.id ?? null, body), onClose);
  const reorder = useReorder(statuses, (s) => s.label || 'this status', setStatuses);

  const named = statuses.filter((s) => s.label.trim());
  const nameMissing = tried && !form.name.trim();
  const statusesMissing = tried && named.length === 0;

  return (
    <Dialog open heading={stage ? 'Edit stage' : 'Add stage'} onClose={onClose}>
      <form
        className="routes-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!form.name.trim() || named.length === 0) return;
          save.mutate({
            name: form.name.trim(),
            customerName: (form.customerName || form.name).trim(),
            customerVisible: form.customerVisible,
            statuses: named.map(({ code, label }) => ({ ...(code ? { code } : {}), label: label.trim() })),
          });
        }}
      >
        <TextInput
          label="Stage name"
          description="Short. It is a column on the Board and a filter in Jobs."
          value={form.name}
          error={nameMissing ? 'Enter a stage name' : ''}
          onChange={(event) => {
            const value = event.detail.value;
            setForm((f) => ({ ...f, name: value }));
          }}
        />
        <Switch
          label="Show this stage in the customer portal"
          description="Off: the customer sees it as part of the next visible stage."
          checked={form.customerVisible}
          onChange={(event) => {
            const checked = event.detail.checked;
            setForm((f) => ({ ...f, customerVisible: checked }));
          }}
        />
        {form.customerVisible ? (
          <TextInput
            label="Name the customer sees"
            value={form.customerName}
            placeholder={form.name}
            onChange={(event) => {
              const value = event.detail.value;
              setForm((f) => ({ ...f, customerName: value }));
            }}
          />
        ) : null}

        <fieldset className="routes-statuses">
          <legend>Statuses in this stage, in order</legend>
          <ol>
            {statuses.map((status, index) => (
              <li key={status.key} className="routes-status-row" {...reorder.rowProps(index)}>
                <button className="routes-handle" {...reorder.handleProps(index)}>
                  <Icon name="more" />
                </button>
                <TextInput
                  label={`Status ${index + 1}`}
                  hideLabel
                  value={status.label}
                  onChange={(event) => {
                    const value = event.detail.value;
                    setStatuses((list) => list.map((s) => (s.key === status.key ? { ...s, label: value } : s)));
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="close"
                  label={`Remove ${status.label || 'this status'}`}
                  onClick={() => setStatuses((list) => list.filter((s) => s.key !== status.key))}
                />
              </li>
            ))}
          </ol>
          <p className="routes-sr" aria-live="polite">
            {reorder.announcement}
          </p>
          {statusesMissing ? (
            <Text size="sm" className="routes-error">
              Add at least one status.
            </Text>
          ) : null}
          <Button variant="subtle" size="sm" iconBefore="plus" onClick={() => setStatuses((list) => [...list, draft({ label: '' })])}>
            Add status
          </Button>
        </fieldset>

        {save.isError ? (
          <Alert tone="danger" heading="The stage was not saved">
            {failure(save.error)}
          </Alert>
        ) : null}
        <div className="routes-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending} busyLabel="Saving the stage">
            Save stage
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Removes a stage. When jobs are in it, they move to a status in another stage first. */
export function RemoveStageDialog({ route, stage, onClose }: { route: RouteSummary; stage: WorkflowStageDef; onClose: () => void }) {
  const count = jobsInStage(route, stage);
  const index = route.stages.findIndex((s) => s.id === stage.id);
  const options = route.stages
    .filter((s) => s.id !== stage.id)
    .flatMap((s) => s.statuses.map((status) => ({ value: status.code, label: `${s.name} · ${status.label}` })));
  // The status just before this stage, or else the first one after it.
  const before = route.stages
    .slice(0, index)
    .flatMap((s) => s.statuses)
    .at(-1);
  const after = route.stages.slice(index + 1).flatMap((s) => s.statuses)[0];
  const [moveTo, setMoveTo] = useState(before?.code ?? after?.code ?? '');
  const remove = useRouteChange(() => routeApi.removeStage(route.id, stage.id, count ? moveTo : undefined), onClose);

  return (
    <Dialog open heading={`Remove the ${stage.name} stage?`} onClose={onClose}>
      {count ? (
        <>
          <Text>{`${count} active ${count === 1 ? 'job is' : 'jobs are'} in this stage. Choose where ${count === 1 ? 'it goes. Its' : 'they go. Their'} history keeps the old status names.`}</Text>
          <Select
            label={`Move ${count === 1 ? 'this job' : `these ${count} jobs`} to`}
            options={options}
            value={moveTo}
            onChange={(event) => setMoveTo(event.detail.value)}
          />
        </>
      ) : (
        <Text>{`No active jobs are in ${stage.name}, so nothing moves. Its ${statusesWord(stage.statuses.length)} go with it.`}</Text>
      )}
      {remove.isError ? (
        <Alert tone="danger" heading="The stage was not removed">
          {failure(remove.error)}
        </Alert>
      ) : null}
      <div className="routes-dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Keep stage
        </Button>
        <Button
          variant="danger"
          disabled={count > 0 && !moveTo}
          busy={remove.isPending}
          busyLabel="Removing the stage"
          onClick={() => remove.mutate(undefined)}
        >
          {count ? 'Move jobs and remove' : 'Remove stage'}
        </Button>
      </div>
    </Dialog>
  );
}

/** A new route, empty or as a copy of the default. It starts as a draft. */
export function NewRouteDialog({ routes, onClose, onCreated }: { routes: RouteSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const source = routes.find((r) => r.isDefault) ?? routes[0];
  const [form, setForm] = useState({
    originCountry: 'JP',
    destinationCountry: source?.destinationCountry ?? 'CY',
    name: '',
    shortLabel: '',
    start: source ? 'copy' : 'empty',
  });
  const name = form.name || routeName(form.originCountry, form.destinationCountry);
  const shortLabel = form.shortLabel || routeLabel(form.originCountry, form.destinationCountry);
  const create = useRouteChange(
    () =>
      routeApi.create({
        name: name.trim(),
        shortLabel: shortLabel.trim(),
        originCountry: form.originCountry,
        destinationCountry: form.destinationCountry,
        ...(form.start === 'copy' && source ? { copyFromId: source.id } : {}),
      }),
    (route) => onCreated(route.id),
  );
  const statusCount = source?.stages.reduce((sum, s) => sum + s.statuses.length, 0) ?? 0;
  const set = (key: keyof typeof form) => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <Dialog open heading="New route" onClose={onClose}>
      <form
        className="routes-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(undefined);
        }}
      >
        <div className="routes-pair">
          <Select label="Vehicles start in" options={COUNTRY_OPTIONS} value={form.originCountry} onChange={set('originCountry')} />
          <Select label="Vehicles are handed over in" options={COUNTRY_OPTIONS} value={form.destinationCountry} onChange={set('destinationCountry')} />
        </div>
        <div className="routes-pair">
          <TextInput label="Route name" value={name} onChange={set('name')} />
          <TextInput label="Short label for tables" value={shortLabel} onChange={set('shortLabel')} />
        </div>
        <RadioGroup
          label="Start with"
          value={form.start}
          options={[
            ...(source
              ? [
                  {
                    value: 'copy',
                    label: `A copy of ${source.name}`,
                    description: `${stagesWord(source.stages.length)} and ${statusesWord(statusCount)} to rename and trim`,
                  },
                ]
              : []),
            { value: 'empty', label: 'An empty route', description: 'Add every stage and status yourself' },
          ]}
          onChange={set('start')}
        />
        <Text size="sm" tone="muted">
          It starts as a draft. New job offers it once it has stages and you switch it on.
        </Text>
        {create.isError ? (
          <Alert tone="danger" heading="The route was not created">
            {failure(create.error)}
          </Alert>
        ) : null}
        <div className="routes-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending} busyLabel="Creating the route">
            Create route
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
