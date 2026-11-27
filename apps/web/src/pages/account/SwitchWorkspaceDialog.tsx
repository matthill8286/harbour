import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, Row, Text, TextInput } from '@atomic-ui/ui-react';
import { ROLE_LABELS } from '@vip/shared';
import { api, secondFactor, setToken, type SessionResponse } from '../../lib/api';
import { homePath, useAuth } from '../../lib/auth';
import { useOrganisations, type MyOrganisation } from '../../lib/organisations';
import { LoadingScreen } from '../../components/ui';
import './Account.css';

/** Moves to another of the person's own workspaces, with a new session. */
export function SwitchWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const user = useAuth((state) => state.user);
  const organisations = useOrganisations();
  const [target, setTarget] = useState<MyOrganisation | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const needsCode = Boolean(user?.twoFactorEnabled);

  async function switchTo(membershipId: string, typed = code) {
    setPending(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/auth/organisations/switch', {
        method: 'POST',
        body: JSON.stringify({ membershipId, ...(needsCode ? secondFactor(typed) : {}) }),
      });
      setToken(session.accessToken);
      // A full load, so nothing from the workspace being left stays on screen or in memory.
      window.location.assign(homePath(session.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setCode('');
      setPending(false);
    }
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    if (target && code.trim()) void switchTo(target.membershipId);
  }

  return (
    <Dialog open heading={target ? `Switch to ${target.name}` : 'Switch workspace'} onClose={onClose}>
      {target ? (
        <form className="account-stack" onSubmit={confirm}>
          <Text>Enter a code to open this workspace, as you do when you sign in.</Text>
          <TextInput
            label="Authenticator code or backup code"
            autocomplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.detail.value)}
            onKeyDown={(event) => {
              // The design system's field does not submit its form on Enter.
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const typed = (event.currentTarget as HTMLElement & { value: string }).value.trim();
              if (target && typed && !pending) void switchTo(target.membershipId, typed);
            }}
          />
          {error ? (
            <Alert tone="danger" heading="You were not switched">
              {error}
            </Alert>
          ) : null}
          <div className="account-dialog-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setTarget(null);
                setCode('');
                setError(null);
              }}
            >
              Back
            </Button>
            <Button type="submit" disabled={!code.trim()} busy={pending} busyLabel="Switching">
              Switch
            </Button>
          </div>
        </form>
      ) : (
        <div className="account-stack">
          {organisations.isLoading ? <LoadingScreen label="Loading your workspaces…" /> : null}
          {organisations.isError ? (
            <Alert tone="danger" heading="Your workspaces could not load">
              Check your connection, then try again.
            </Alert>
          ) : null}
          <div role="list" aria-label="Your workspaces" className="switch-list">
            {organisations.data?.map((item) => (
              <div role="listitem" key={item.membershipId} className="switch-item">
                <Row heading={item.name} meta={item.current ? `${ROLE_LABELS[item.role]} · You are here` : ROLE_LABELS[item.role]} />
                {item.current ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    label={`Switch to ${item.name}`}
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      if (needsCode) setTarget(item);
                      else void switchTo(item.membershipId);
                    }}
                  >
                    Switch
                  </Button>
                )}
              </div>
            ))}
          </div>
          {error ? (
            <Alert tone="danger" heading="You were not switched">
              {error}
            </Alert>
          ) : null}
          <div className="account-dialog-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
