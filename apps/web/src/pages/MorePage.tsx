import { useNavigate } from 'react-router-dom';
import { Button, Card, Heading, Row } from '@atomic-ui/ui-react';
import { useAuth } from '../lib/auth';
import { useSession } from '../lib/session';
import { PhoneHeader } from '../components/PhoneHeader';

/**
 * The places a phone's tab bar has no room for, after the Figma frame
 * "Business · Mobile · More". On a desktop the side navigation lists them all.
 */
export function MorePage() {
  const { canManage, workspace } = useSession();
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          More
        </Heading>
      </PhoneHeader>
      <Heading level={1} size="3xl" className="hidden md:block">
        More
      </Heading>
      <Card>
        <div role="list" aria-label={`${workspace} places`}>
          <Row role="listitem" heading="Customers" meta="People you import for" href="/customers" />
          <Row role="listitem" divided heading="Trackers" meta="GPS units and where they are fitted" href="/trackers" />
          {canManage ? <Row role="listitem" divided heading="Workspace" meta="Your business, routes and stages" href="/organisation" /> : null}
          <Row role="listitem" divided heading="Account and security" meta="Two-factor sign-in and backup codes" href="/security" />
        </div>
      </Card>
      <Button
        variant="secondary"
        iconBefore="log-out"
        full
        onClick={() => {
          logout();
          navigate('/login');
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
