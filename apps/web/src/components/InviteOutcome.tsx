import { useState } from 'react';
import { Alert, Button, Text } from '@atomic-ui/ui-react';

/** What the api says after sending an invite. */
export type InviteDelivery = {
  emailSent: boolean;
  /** Only in local development, where no email leaves the machine. */
  inviteUrl?: string;
};

/**
 * Says whether the invite email went. The link itself reaches the invitee's
 * mailbox only, so there is normally nothing to copy.
 */
export function InviteOutcome({ delivery, email, className }: { delivery: InviteDelivery; email: string; className: string }) {
  const [copied, setCopied] = useState(false);
  const { emailSent, inviteUrl } = delivery;

  return (
    <>
      {emailSent ? (
        <Alert tone="success" heading="Invite sent">
          {`We emailed the invite to ${email}. Only the link in that email can be used to accept it.`}
        </Alert>
      ) : (
        <Alert tone="danger" heading="The invite email was not sent">
          {`The invite for ${email} is saved, but we could not email it. Try sending it again later.`}
        </Alert>
      )}
      {inviteUrl ? (
        <div className={className}>
          <Text size="sm">Local development only: no email leaves this machine, so here is the link.</Text>
          <code>{inviteUrl}</code>
          <Button
            variant="secondary"
            size="sm"
            iconBefore={copied ? 'check' : 'document'}
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
