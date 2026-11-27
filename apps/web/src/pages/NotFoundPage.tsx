import { Button, Card, Heading, Text } from '@atomic-ui/ui-react';
import { useSession } from '../lib/session';
import { PhoneHeader } from '../components/PhoneHeader';
import './portal/Portal.css';

/** Any unknown link, after the Figma frames "Not found" for the workspace and the customer portal. */
export function NotFoundPage() {
  const { isPortal, workspace } = useSession();
  return (
    <div className="portal">
      <PhoneHeader>
        <Heading level={1} size="3xl">
          Page not found
        </Heading>
      </PhoneHeader>
      <div className="portal-heading">
        <Text size="sm" tone="muted">
          {isPortal ? `${workspace} · Customer portal` : workspace}
        </Text>
        <Heading level={1} size="4xl">
          Page not found
        </Heading>
      </div>
      <Card className="portal-card portal-state">
        <Heading level={2} size="xl">
          This page does not exist
        </Heading>
        <Text tone="muted">The link may be old or mistyped.</Text>
        <Button href={isPortal ? '/portal' : '/'}>{isPortal ? 'Back to your vehicles' : 'Back to the Board'}</Button>
      </Card>
    </div>
  );
}
