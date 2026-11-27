import { Icon } from '@atomic-ui/ui-react';
import type { CustomerStep } from '@vip/shared';

/**
 * The customer's journey as bars, one per step they can see, each with its name
 * and a line under it. On the vehicle page each step also carries a mark: a
 * tick when done, a dot when current.
 */
export function JourneySteps({ steps, marks = false, label = 'Journey' }: { steps: CustomerStep[]; marks?: boolean; label?: string }) {
  return (
    <ol className={`portal-steps${marks ? ' has-marks' : ''}`} aria-label={label}>
      {steps.map((step) => (
        <li key={step.id} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className="portal-steps-bar" aria-hidden="true" />
          <span className="portal-steps-text">
            {marks ? (
              <span className="portal-steps-mark" aria-hidden="true">
                {step.state === 'done' ? <Icon name="check" size="sm" /> : null}
              </span>
            ) : null}
            <span>
              <strong>{step.name}</strong>
              {step.detail ? <small>{step.detail}</small> : null}
              <span className="portal-sr">{step.state === 'done' ? ', done' : step.state === 'current' ? ', now' : ''}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
