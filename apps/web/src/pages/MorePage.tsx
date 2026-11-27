import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Button, Card, Heading, Icon, Row, Text } from '@atomic-ui/ui-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { PhoneHeader } from '../components/PhoneHeader';
import { SignOutDialog } from './account/SignOutDialog';
import './account/Account.css';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The places a phone's tab bar has no room for, after the Figma frame
 * "Business · Mobile · More". On a desktop the side navigation lists them all.
 */
export function MorePage() {
  const { user, canManage, workspace, roleLabel } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  // The same queries the Customers and Trackers pages use, so these counts are usually cached already.
  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<unknown[]>('/customers'),
  });
  const trackers = useQuery({
    queryKey: ['trackers'],
    queryFn: () => api<Array<{ status: string }>>('/trackers'),
  });
  const silent = trackers.data?.filter((t) => t.status === 'OFFLINE').length ?? 0;
  const trackerMeta = trackers.data
    ? [plural(trackers.data.length, 'device', 'devices'), silent ? `${silent} silent` : null].filter(Boolean).join(' · ')
    : 'GPS units and where they are fitted';

  return (
    <div className="account">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          More
        </Heading>
        <Text size="sm">{workspace}</Text>
      </PhoneHeader>
      <Heading level={1} size="4xl" className="account-heading">
        More
      </Heading>

      {user ? (
        <Card>
          <Row heading={user.name} meta={`${roleLabel} · ${user.email}`} href="/security">
            <Avatar slot="start" fullName={user.name} />
          </Row>
        </Card>
      ) : null}

      <Card>
        <div role="list" aria-label={`${workspace} places`}>
          <Row
            role="listitem"
            heading="Customers"
            meta={customers.data ? plural(customers.data.length, 'customer', 'customers') : 'People you import for'}
            href="/customers"
          >
            <Icon slot="start" name="users" />
          </Row>
          <Row role="listitem" divided heading="Trackers" meta={trackerMeta} href="/trackers">
            <Icon slot="start" name="radio" />
          </Row>
          {canManage ? (
            <Row role="listitem" divided heading="Workspace" meta="Company, plan and team" href="/organisation">
              <Icon slot="start" name="settings" />
            </Row>
          ) : null}
          <Row role="listitem" divided heading="Account and security" meta="Profile, password, two-factor" href="/security">
            <Icon slot="start" name="user" />
          </Row>
        </div>
      </Card>

      <Card>
        <Button variant="ghost" iconBefore="log-out" full className="more-sign-out" onClick={() => setSigningOut(true)}>
          Sign out
        </Button>
      </Card>

      {signingOut ? <SignOutDialog onClose={() => setSigningOut(false)} /> : null}
    </div>
  );
}
