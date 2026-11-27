import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Breadcrumbs, Button, Card, Heading, Icon, Select, Switch, Text, TextInput } from '@atomic-ui/ui-react';
import { routeProblem, type WorkflowStageDef } from '@vip/shared';
import { PhoneHeader } from '../../components/PhoneHeader';
import { LoadingScreen } from '../../components/ui';
import { COUNTRY_CODES, countryName } from '../job/countries';
import { NewRouteDialog, RemoveStageDialog, StageDialog } from './RouteDialogs';
import { routeApi, routeSummary, stageInput, stagesWord, useRouteChange, useRoutes, type RouteSummary } from './routes';
import { useReorder } from './useReorder';
import './Routes.css';

const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) }));
const failure = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

type Open = { kind: 'new' } | { kind: 'stage'; stage: WorkflowStageDef | null } | { kind: 'remove'; stage: WorkflowStageDef } | null;

/** The route's name, label, countries, and whether it is switched on and the default. */
function RouteDetails({ route }: { route: RouteSummary }) {
  const [edits, setEdits] = useState<Partial<Pick<RouteSummary, 'name' | 'shortLabel' | 'originCountry' | 'destinationCountry'>>>({});
  const form = {
    name: edits.name ?? route.name,
    shortLabel: edits.shortLabel ?? route.shortLabel,
    originCountry: edits.originCountry ?? route.originCountry,
    destinationCountry: edits.destinationCountry ?? route.destinationCountry,
  };
  const changed = Object.keys(edits).length > 0;
  const save = useRouteChange(
    (body: Parameters<typeof routeApi.update>[1]) => routeApi.update(route.id, body),
    () => setEdits({}),
  );
  const problem = routeProblem(route);
  const set = (key: keyof typeof form) => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setEdits((current) => ({ ...current, [key]: value }));
  };

  return (
    <Card className="routes-card">
      <Heading level={2} size="md">{`${route.name} · details`}</Heading>
      <form
        className="routes-details"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && form.name.trim() && form.shortLabel.trim()) save.mutate(form);
        }}
      >
        <TextInput label="Route name" description="Shown on the Board and in job headers." value={form.name} onChange={set('name')} />
        <TextInput label="Short label for tables" description="Used in narrow columns." value={form.shortLabel} onChange={set('shortLabel')} />
        <Select label="Vehicles start in" options={COUNTRY_OPTIONS} value={form.originCountry} onChange={set('originCountry')} />
        <Select label="Vehicles are handed over in" options={COUNTRY_OPTIONS} value={form.destinationCountry} onChange={set('destinationCountry')} />
        <div className="routes-details-actions">
          <Button type="submit" disabled={!changed || !form.name.trim() || !form.shortLabel.trim()} busy={save.isPending} busyLabel="Saving the route">
            Save route
          </Button>
        </div>
      </form>

      <div className="routes-switches">
        {route.isDefault ? (
          <Text size="sm" tone="muted">
            New jobs follow this route unless someone picks another. A workspace always has one default.
          </Text>
        ) : route.active ? (
          <>
            <Text size="sm" tone="muted">
              Switched on. New job offers it.
            </Text>
            <div className="routes-switch-actions">
              <Button variant="secondary" size="sm" busy={save.isPending} busyLabel="Updating" onClick={() => save.mutate({ isDefault: true })}>
                Make default
              </Button>
              <Button variant="ghost" size="sm" busy={save.isPending} busyLabel="Updating" onClick={() => save.mutate({ active: false })}>
                Back to draft
              </Button>
            </div>
          </>
        ) : (
          <>
            <Text size="sm" tone="muted">
              {problem ? `Draft. ${problem}` : 'Draft. Switch it on when its stages are ready, and New job will offer it.'}
            </Text>
            <Button size="sm" disabled={Boolean(problem)} busy={save.isPending} busyLabel="Switching it on" onClick={() => save.mutate({ active: true })}>
              Switch on
            </Button>
          </>
        )}
      </div>
      {save.isError ? (
        <Alert tone="danger" heading="The route was not saved">
          {failure(save.error)}
        </Alert>
      ) : null}
    </Card>
  );
}

/** The route as staff see it on a job, and the shorter version the customer sees. */
function HowItLooks({ route }: { route: RouteSummary }) {
  const visible = route.stages.filter((stage) => stage.customerVisible);
  const strip = (names: string[]) => (
    <ol className="routes-strip">
      {names.map((name, index) => (
        <li key={`${name}-${index}`}>
          <span aria-hidden="true" />
          {name}
        </li>
      ))}
    </ol>
  );
  return (
    <Card className="routes-card">
      <Heading level={2} size="md">
        How it looks
      </Heading>
      {route.stages.length ? (
        <>
          <Text size="sm" tone="muted">{`You see ${stagesWord(route.stages.length)}`}</Text>
          {strip(route.stages.map((s) => s.name))}
          <Text size="sm" tone="muted">{`The customer sees ${visible.length} ${visible.length === 1 ? 'step' : 'steps'}`}</Text>
          {strip(visible.map((s) => s.customerName || s.name))}
          <Text size="sm" tone="muted">
            A stage hidden from the customer is shown as part of the next visible one.
          </Text>
        </>
      ) : (
        <Text size="sm" tone="muted">
          Add a stage to see the route as staff and customers will.
        </Text>
      )}
    </Card>
  );
}

function Stages({
  route,
  onEdit,
  onRemove,
  onAdd,
}: {
  route: RouteSummary;
  onEdit: (s: WorkflowStageDef) => void;
  onRemove: (s: WorkflowStageDef) => void;
  onAdd: () => void;
}) {
  const reorder = useRouteChange((ids: string[]) => routeApi.reorder(route.id, ids));
  const visibility = useRouteChange(({ stage, visible }: { stage: WorkflowStageDef; visible: boolean }) =>
    routeApi.saveStage(route.id, stage.id, stageInput(stage, { customerVisible: visible })),
  );
  // Shown in the new order straight away; the list catches up when the save lands.
  const [order, setOrder] = useState<WorkflowStageDef[] | null>(null);
  const stages = order ?? route.stages;
  const handles = useReorder(
    stages,
    (s) => s.name,
    (next) => {
      setOrder(next);
      reorder.mutate(
        next.map((s) => s.id),
        { onSettled: () => setOrder(null) },
      );
    },
  );
  const error = reorder.error ?? visibility.error;

  return (
    <Card className="routes-card">
      <div className="routes-card-head">
        <div>
          <Heading level={2} size="md">{`Stages of ${route.name}`}</Heading>
          <Text size="sm" tone="muted">
            Drag a stage, or focus its handle and use the arrow keys, to reorder. A job moves through the statuses top to bottom, left to right.
          </Text>
        </div>
        <Button variant="subtle" iconBefore="plus" onClick={onAdd}>
          Add stage
        </Button>
      </div>

      {route.activeJobs ? (
        <Alert tone="info" heading={`${route.activeJobs} active ${route.activeJobs === 1 ? 'job uses' : 'jobs use'} this route`}>
          Renaming a stage or a status is safe. Removing one asks where its jobs should go first. Other routes are not affected.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" heading="That change was not saved">
          {failure(error)}
        </Alert>
      ) : null}

      {stages.length === 0 ? (
        <Text tone="muted" className="routes-empty">
          No stages yet. Add the first one, such as the country vehicles start in.
        </Text>
      ) : (
        <ol className="routes-stages" aria-label={`Stages of ${route.name}`}>
          {stages.map((stage, index) => (
            <li key={stage.id} className="routes-stage" {...handles.rowProps(index)}>
              <button className="routes-handle" {...handles.handleProps(index)}>
                <Icon name="more" />
              </button>
              <span className="routes-order" aria-hidden="true">
                {index + 1}
              </span>
              <div className="routes-stage-name">
                <strong>{stage.name}</strong>
              </div>
              <ul className="routes-chips" aria-label={`Statuses in ${stage.name}`}>
                {stage.statuses.map((status) => (
                  <li key={status.code}>
                    <Badge>{status.label}</Badge>
                  </li>
                ))}
              </ul>
              <div className="routes-visibility">
                <Switch
                  label={`Customer sees ${stage.name}`}
                  hideLabel
                  checked={stage.customerVisible}
                  disabled={visibility.isPending}
                  onChange={(event) => visibility.mutate({ stage, visible: event.detail.checked })}
                />
                <span aria-hidden="true">{stage.customerVisible ? stage.customerName || stage.name : 'Hidden'}</span>
              </div>
              <div className="routes-stage-actions">
                <Button variant="ghost" size="sm" icon="pencil" label={`Edit ${stage.name}`} onClick={() => onEdit(stage)} />
                <Button variant="ghost" size="sm" icon="trash" label={`Remove ${stage.name}`} className="routes-remove" onClick={() => onRemove(stage)} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="routes-sr" aria-live="polite">
        {handles.announcement}
      </p>

      <div className="routes-terminal">
        <Badge tone="inverse">Completed</Badge>
        <Badge tone="danger">Cancelled</Badge>
        <Text size="sm" tone="muted">
          Always exist in every workspace and are not part of the route.
        </Text>
      </div>
    </Card>
  );
}

/**
 * Routes and stages, after the Figma frame "Business · Workspace · Routes and
 * stages": choose a route, edit its details, and add, rename, hide, reorder and
 * remove its stages and statuses.
 */
export function RoutesPage() {
  const routes = useRoutes();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Open>(null);
  const list = routes.data ?? [];
  const route = list.find((r) => r.id === params.get('route')) ?? list.find((r) => r.isDefault) ?? list[0];
  const choose = (id: string) => setParams({ route: id }, { replace: true });

  return (
    <div className="routes">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          Routes and stages
        </Heading>
        <Text size="sm">{routes.data ? `${list.length} ${list.length === 1 ? 'route' : 'routes'} in this workspace` : ' '}</Text>
      </PhoneHeader>

      <div className="routes-heading">
        <Breadcrumbs
          items={[
            { label: 'Workspace', href: '/organisation' },
            { label: 'Routes and stages', href: '/organisation/routes' },
          ]}
        />
        <Heading level={1} size="4xl">
          Routes and stages
        </Heading>
        <Text tone="muted">
          A workspace can run several routes. Each job follows the route chosen when it was created, with that route's stages and statuses.
        </Text>
      </div>

      {routes.isLoading ? (
        <LoadingScreen label="Loading routes…" />
      ) : routes.isError || !route ? (
        <Alert tone="danger" heading="Routes could not load">
          Check your connection, then try again.
          <div className="job-retry">
            <Button variant="secondary" onClick={() => void routes.refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          <div className="routes-picker" role="group" aria-label="Routes">
            {list.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`routes-pick${item.id === route.id ? ' is-current' : ''}`}
                aria-pressed={item.id === route.id}
                onClick={() => choose(item.id)}
              >
                <span className="routes-pick-head">
                  <strong>{item.name}</strong>
                  {item.isDefault ? <Badge tone="brand">Default for new jobs</Badge> : !item.active ? <Badge>Draft</Badge> : null}
                </span>
                <span className="routes-pick-meta">{routeSummary(item)}</span>
              </button>
            ))}
            <Button variant="subtle" iconBefore="plus" onClick={() => setOpen({ kind: 'new' })}>
              New route
            </Button>
          </div>

          <div className="routes-grid">
            <RouteDetails key={route.id} route={route} />
            <HowItLooks route={route} />
          </div>

          <Stages
            key={`stages-${route.id}`}
            route={route}
            onAdd={() => setOpen({ kind: 'stage', stage: null })}
            onEdit={(stage) => setOpen({ kind: 'stage', stage })}
            onRemove={(stage) => setOpen({ kind: 'remove', stage })}
          />
        </>
      )}

      {open?.kind === 'new' ? (
        <NewRouteDialog
          routes={list}
          onClose={() => setOpen(null)}
          onCreated={(id) => {
            setOpen(null);
            choose(id);
          }}
        />
      ) : null}
      {open?.kind === 'stage' && route ? <StageDialog route={route} stage={open.stage} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'remove' && route ? <RemoveStageDialog route={route} stage={open.stage} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
