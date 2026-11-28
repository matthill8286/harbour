import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';

type GpsSettingsView = {
  retentionDays: number | null;
  defaultRetentionDays: number;
  minRetentionDays: number;
  maxRetentionDays: number;
  gatewaySecretSetAt: string | null;
  gatewayUrl: string;
  /** Sent once, when a secret is made. Never shown again. */
  secret?: string;
};

const message = (error: unknown) => (error instanceof Error ? error.message : 'Try again.');

/**
 * How long this workspace keeps GPS positions, and the secret for sending
 * positions from its own Flespi account.
 */
export function GpsSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['gps-settings'], queryFn: () => api<GpsSettingsView>('/organisation/gps') });
  const [days, setDays] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const saved = (view: GpsSettingsView) => queryClient.setQueryData(['gps-settings'], { ...view, secret: undefined });
  const retention = useMutation({
    mutationFn: (value: number | null) => api<GpsSettingsView>('/organisation/gps', { method: 'PATCH', body: JSON.stringify({ retentionDays: value }) }),
    onSuccess: (view) => {
      setDays(null);
      saved(view);
    },
  });
  const rotate = useMutation({
    mutationFn: () => api<GpsSettingsView>('/organisation/gps/secret', { method: 'POST' }),
    onSuccess: (view) => {
      setSecret(view.secret ?? null);
      saved(view);
    },
  });
  const revoke = useMutation({
    mutationFn: () => api<GpsSettingsView>('/organisation/gps/secret', { method: 'DELETE' }),
    onSuccess: (view) => {
      setSecret(null);
      setConfirmRevoke(false);
      saved(view);
    },
  });

  const view = settings.data;
  if (!view) return null;
  const current = view.retentionDays ?? view.defaultRetentionDays;
  const typed = days ?? String(current);
  const number = Number(typed);
  const valid = /^\d+$/.test(typed.trim()) && number >= view.minRetentionDays && number <= view.maxRetentionDays;
  const changed = valid && number !== current;

  return (
    <Card className="account-card">
      <Heading level={2} size="md">
        GPS data
      </Heading>
      <form
        className="account-profile"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) retention.mutate(number);
        }}
      >
        <TextInput
          label="Keep GPS positions for (days)"
          description={`Positions are deleted this many days after their job closes. Choose ${view.minRetentionDays} to ${view.maxRetentionDays}. Harbour’s default is ${view.defaultRetentionDays}.`}
          inputmode="numeric"
          value={typed}
          error={typed && !valid ? `Enter a whole number from ${view.minRetentionDays} to ${view.maxRetentionDays}` : ''}
          onChange={(event) => setDays(event.detail.value)}
        />
        <div className="account-actions">
          {view.retentionDays != null ? (
            <Button variant="ghost" busy={retention.isPending} busyLabel="Going back to the default" onClick={() => retention.mutate(null)}>
              Use the default
            </Button>
          ) : null}
          <Button type="submit" disabled={!changed} busy={retention.isPending} busyLabel="Saving the period">
            Save period
          </Button>
        </div>
        {retention.isError ? (
          <Alert tone="danger" heading="The period was not saved" className="account-wide">
            {message(retention.error)}
          </Alert>
        ) : null}
      </form>

      <div className="account-gps-gateway">
        <Heading level={3} size="sm">
          Your own Flespi account
        </Heading>
        <Text size="sm" tone="muted">
          Units normally report through Harbour’s gateway. If you run your own Flespi account, point its HTTP stream at the address below with the header
          X-Harbour-Gps-Secret. That secret only reaches this workspace’s confirmed units.
        </Text>
        <TextInput label="Stream address" value={view.gatewayUrl} readonly />
        {secret ? (
          <Alert tone="warning" heading="Copy the secret now" className="account-wide">
            <Text size="sm">It is shown once. If it is lost, make a new one.</Text>
            <TextInput label="Secret" value={secret} readonly />
          </Alert>
        ) : (
          <Text size="sm">
            {view.gatewaySecretSetAt
              ? `A secret was made on ${formatDate(view.gatewaySecretSetAt)}. Making a new one stops the old one at once.`
              : 'No secret has been made.'}
          </Text>
        )}
        <div className="account-actions">
          {view.gatewaySecretSetAt && !confirmRevoke ? (
            <Button variant="ghost" onClick={() => setConfirmRevoke(true)}>
              Turn off
            </Button>
          ) : null}
          {confirmRevoke ? (
            <>
              <Text size="sm">Positions from your own account stop at once.</Text>
              <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
                Keep it
              </Button>
              <Button variant="danger" busy={revoke.isPending} busyLabel="Turning off the secret" onClick={() => revoke.mutate()}>
                Turn off
              </Button>
            </>
          ) : (
            <Button variant="secondary" busy={rotate.isPending} busyLabel="Making a secret" onClick={() => rotate.mutate()}>
              {view.gatewaySecretSetAt ? 'Make a new secret' : 'Make a secret'}
            </Button>
          )}
        </div>
        {rotate.isError || revoke.isError ? (
          <Alert tone="danger" heading="The secret was not changed">
            {message(rotate.error ?? revoke.error)}
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
