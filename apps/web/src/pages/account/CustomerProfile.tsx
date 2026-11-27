import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Button, Card, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSession } from '../../lib/session';
import { LoadingScreen } from '../../components/ui';

type OwnDetails = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; address: string | null };
type Editable = Pick<OwnDetails, 'firstName' | 'lastName'> & { phone: string; address: string };

const KEY = ['portal-me'];

/**
 * A customer's own details, after the Figma frame "Customer · Account and
 * security". The importer sees them and uses them about collection; the email
 * is how the customer signs in, so it stays as it is.
 */
export function CustomerProfile({ onSignOut }: { onSignOut: () => void }) {
  const { workspace } = useSession();
  const refresh = useAuth((state) => state.refresh);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api<OwnDetails>('/portal/me') });
  const [edits, setEdits] = useState<Partial<Editable>>({});
  const me = query.data;
  const form: Editable | null = me
    ? {
        firstName: edits.firstName ?? me.firstName,
        lastName: edits.lastName ?? me.lastName,
        phone: edits.phone ?? me.phone ?? '',
        address: edits.address ?? me.address ?? '',
      }
    : null;
  const save = useMutation({
    mutationFn: () => api<OwnDetails>('/portal/me', { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(KEY, saved);
      setEdits({});
      // The name in the header follows the customer's own name.
      await refresh();
    },
  });

  if (query.isLoading) return <LoadingScreen label="Loading your details…" />;
  if (!me || !form) {
    return (
      <Alert tone="danger" heading="Your details could not load">
        Check your connection, then reload the page.
      </Alert>
    );
  }

  const name = `${form.firstName} ${form.lastName}`.trim();
  const changed = Object.keys(edits).length > 0;
  const missing = !form.firstName.trim() || !form.lastName.trim();
  const set = (key: keyof Editable) => (event: CustomEvent<{ value: string }>) => {
    const value = event.detail.value;
    setEdits((current) => ({ ...current, [key]: value }));
  };

  return (
    <Card className="account-card">
      <div className="account-card-head">
        <div className="account-who">
          <Avatar fullName={name} size="lg" />
          <div>
            <Heading level={2} size="xl">
              {name}
            </Heading>
            <Text size="sm" tone="muted">{`Customer of ${workspace}`}</Text>
          </div>
        </div>
        <Button variant="secondary" iconBefore="log-out" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
      <form
        className="account-profile is-customer"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && !missing) save.mutate();
        }}
      >
        <TextInput
          label="First name"
          autocomplete="given-name"
          value={form.firstName}
          error={!form.firstName.trim() ? 'Enter your first name' : ''}
          onChange={set('firstName')}
        />
        <TextInput
          label="Last name"
          autocomplete="family-name"
          value={form.lastName}
          error={!form.lastName.trim() ? 'Enter your last name' : ''}
          onChange={set('lastName')}
        />
        <TextInput label="Phone" type="tel" autocomplete="tel" value={form.phone} onChange={set('phone')} />
        <TextInput label="Email, used to sign in" type="email" value={me.email ?? ''} disabled className="account-half" />
        <TextInput label="Address" autocomplete="street-address" value={form.address} onChange={set('address')} className="account-half" />
        {save.isError ? (
          <Alert tone="danger" heading="Your details were not saved" className="account-wide">
            {save.error instanceof Error ? save.error.message : 'Try again.'}
          </Alert>
        ) : null}
        <div className="account-wide account-actions is-split">
          <Text size="sm" tone="muted">{`${workspace} sees these details and uses them to contact you about collection.`}</Text>
          <Button type="submit" disabled={!changed || missing} busy={save.isPending} busyLabel="Saving your details">
            {save.isSuccess && !changed ? 'Saved' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
