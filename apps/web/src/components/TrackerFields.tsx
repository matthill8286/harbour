import { Checkbox, Select, Text, TextInput } from '@atomic-ui/ui-react';
import { describeMinutes, needsFitter, noSignalAfterMinutes, TRACKER_STATEMENTS, type TrackerPowerSource } from '@vip/shared';
import { intervalOptions, POWER_SOURCE_OPTIONS, type TrackerDetails } from '../lib/trackerDetails';
import './TrackerFields.css';

/**
 * How a unit is powered and how often it reports, and, for a hard-wired or
 * diagnostic-port unit, who fitted it and whether the owner's permission is held.
 */
export function TrackerDetailsFields({ value, onChange }: { value: TrackerDetails; onChange: (next: TrackerDetails) => void }) {
  const set = (patch: Partial<TrackerDetails>) => onChange({ ...value, ...patch });
  const wired = needsFitter(value.powerSource);
  return (
    <div className="tracker-fields">
      <Select
        label="How it is powered"
        description="A battery unit needs no fitter and leaves the vehicle unchanged."
        options={POWER_SOURCE_OPTIONS}
        value={value.powerSource}
        onChange={(event) => set({ powerSource: event.detail.value as TrackerPowerSource })}
      />
      <Select
        label="How often it reports"
        description={`Set this to match the unit. Harbour calls it silent after ${describeMinutes(noSignalAfterMinutes(value.reportIntervalMinutes))} without a report.`}
        options={intervalOptions(value.reportIntervalMinutes)}
        value={String(value.reportIntervalMinutes)}
        onChange={(event) => set({ reportIntervalMinutes: Number(event.detail.value) })}
      />
      {wired ? (
        <>
          <TextInput
            label="Fitter"
            description="The qualified fitter or company that installs the unit."
            value={value.fittedBy}
            onChange={(event) => set({ fittedBy: event.detail.value })}
          />
          <Checkbox
            label="We hold the vehicle owner’s written permission to fit this unit"
            checked={value.ownerPermissionHeld}
            onChange={(event) => set({ ownerPermissionHeld: Boolean(event.detail.value) })}
          />
          <Text size="sm" tone="muted">
            The unit can go on a job once the fitter and the owner’s permission are recorded. The fitter takes it out and restores the wiring when the job ends.
          </Text>
        </>
      ) : null}
    </div>
  );
}

/** The lawful-use statement for a unit's power source, with its tick box. */
export function TrackerStatement({
  powerSource,
  confirmed,
  onChange,
}: {
  powerSource: TrackerPowerSource;
  confirmed: boolean;
  onChange: (confirmed: boolean) => void;
}) {
  return (
    <div className="tracker-statement">
      <Text size="sm">{TRACKER_STATEMENTS[powerSource]}</Text>
      <Checkbox label="I confirm this statement" checked={confirmed} onChange={(event) => onChange(Boolean(event.detail.value))} />
    </div>
  );
}
