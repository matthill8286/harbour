import { escapeHtml, wrapHtml } from './customer-email';

type Email = { subject: string; text: string; html: string };

export type StaffInviteEmail = {
  brandName: string;
  roleLabel: string;
  inviteUrl: string;
};

export function composeStaffInviteEmail(invite: StaffInviteEmail): Email {
  const subject = `Join ${invite.brandName} on Harbour`;
  const intro = `${invite.brandName} has invited you to join their team on Harbour as ${invite.roleLabel}.`;
  const outro =
    'The link works for seven days. If you were not expecting this, ignore this email.';
  return {
    subject,
    text: [
      'Hi,',
      '',
      intro,
      'Open this link to accept:',
      invite.inviteUrl,
      '',
      outro,
    ].join('\n'),
    html: wrapHtml(
      invite.brandName,
      subject,
      `
        <p>Hi,</p>
        <p>${escapeHtml(intro)}</p>
        <p><a href="${escapeHtml(invite.inviteUrl)}">Accept the invite</a></p>
        <p style="color:#666;font-size:14px">${escapeHtml(outro)}</p>
      `,
    ),
  };
}

export type LowBatteryEmail = {
  brandName: string;
  reference: string;
  serialNumber: string;
  batteryLevel: number;
  jobUrl: string;
};

/** Tells a workspace's team that a battery unit on a job is running low. */
export function composeLowBatteryEmail(alert: LowBatteryEmail): Email {
  const subject = `Tracker battery low on ${alert.reference}`;
  const intro = `The tracker ${alert.serialNumber} on job ${alert.reference} reported a battery level of ${alert.batteryLevel}%.`;
  const next =
    'A battery unit can run flat between reports. Charge or replace it before the vehicle goes quiet.';
  return {
    subject,
    text: ['Hi,', '', intro, next, '', 'Open the job:', alert.jobUrl].join(
      '\n',
    ),
    html: wrapHtml(
      alert.brandName,
      subject,
      `
        <p>Hi,</p>
        <p>${escapeHtml(intro)}</p>
        <p>${escapeHtml(next)}</p>
        <p><a href="${escapeHtml(alert.jobUrl)}">Open the job</a></p>
      `,
    ),
  };
}

/*
 * Anyone can ask for the two emails below to be sent to any address. They carry
 * nothing the person asking typed, so they cannot be used to send a message.
 */

export function composeSignupConfirmEmail(confirmUrl: string): Email {
  return accountEmail({
    subject: 'Confirm your email to create your Harbour workspace',
    intro:
      'Someone, we hope you, asked to create a Harbour workspace with this email.',
    url: confirmUrl,
    action: 'Confirm your email and choose a password',
    outro:
      'The link works for 24 hours. If this was not you, ignore this email. Nothing has been created.',
  });
}

export function composeAccountExistsEmail(urls: {
  signInUrl: string;
  resetUrl: string;
}): Email {
  return accountEmail({
    subject: 'You already have a Harbour account',
    intro:
      'Someone, we hope you, tried to create a Harbour workspace with this email. It already has an account, so nothing has changed.',
    url: urls.signInUrl,
    action: 'Sign in',
    outro: `If you have forgotten your password, reset it here: ${urls.resetUrl}`,
  });
}

function accountEmail(input: {
  subject: string;
  intro: string;
  url: string;
  action: string;
  outro: string;
}): Email {
  return {
    subject: input.subject,
    text: [
      'Hi,',
      '',
      input.intro,
      '',
      `${input.action}: ${input.url}`,
      '',
      input.outro,
    ].join('\n'),
    html: wrapHtml(
      'Harbour',
      input.subject,
      `
        <p>Hi,</p>
        <p>${escapeHtml(input.intro)}</p>
        <p><a href="${escapeHtml(input.url)}">${escapeHtml(input.action)}</a></p>
        <p style="color:#666;font-size:14px">${escapeHtml(input.outro)}</p>
      `,
    ),
  };
}

export type ClosureEmailKind = 'SCHEDULED' | 'REMINDER' | 'CANCELLED';

export type ClosureEmail = {
  kind: ClosureEmailKind;
  workspaceName: string;
  contractEndsAt: Date;
  deleteAfter: Date;
  workspaceUrl: string;
};

/** Such as 31 January 2027, as the date is in UTC. */
export function formatClosureDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Tells a workspace's Admins that its contract ends and its data will be
 * deleted, reminds them before the deletion, or says the deletion is cancelled.
 */
export function composeClosureEmail(
  closure: ClosureEmail,
  now = new Date(),
): Email {
  const ends = formatClosureDate(closure.contractEndsAt);
  const deletes = formatClosureDate(closure.deleteAfter);
  const contract =
    closure.contractEndsAt <= now
      ? `The Harbour contract for ${closure.workspaceName} ended on ${ends}.`
      : `The Harbour contract for ${closure.workspaceName} ends on ${ends}.`;
  const deletion = `After ${deletes}, all of the workspace's data and files will be deleted. This cannot be undone.`;
  const keeps =
    'The workspace keeps working until then, so you can export everything first.';
  const how =
    'An Admin can download all of it as one file from the Workspace page, under Export all workspace data.';
  const content: Record<
    ClosureEmailKind,
    { subject: string; paragraphs: string[]; action?: string }
  > = {
    SCHEDULED: {
      subject: `${closure.workspaceName} will be deleted after ${deletes}`,
      paragraphs: [contract, deletion, keeps, how],
      action: 'Open the Workspace page',
    },
    REMINDER: {
      subject: `Reminder: ${closure.workspaceName} will be deleted after ${deletes}`,
      paragraphs: [
        contract,
        deletion,
        'If you have not exported the workspace yet, do it before then.',
        how,
      ],
      action: 'Open the Workspace page',
    },
    CANCELLED: {
      subject: `${closure.workspaceName} will no longer be deleted`,
      paragraphs: [
        `The deletion of ${closure.workspaceName} that was due after ${deletes} is cancelled.`,
        'The workspace and all of its data stay as they are. You do not need to do anything.',
      ],
    },
  };
  const { subject, paragraphs, action } = content[closure.kind];
  const outro =
    'You get this email because you are an Admin of the workspace. If you have a question about the contract, contact Impakt, who run Harbour.';
  return {
    subject,
    text: [
      'Hi,',
      '',
      ...paragraphs,
      ...(action ? ['', `${action}: ${closure.workspaceUrl}`] : []),
      '',
      outro,
    ].join('\n'),
    html: wrapHtml(
      'Harbour',
      subject,
      `
        <p>Hi,</p>
        ${paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n        ')}
        ${action ? `<p><a href="${escapeHtml(closure.workspaceUrl)}">${escapeHtml(action)}</a></p>` : ''}
        <p style="color:#666;font-size:14px">${escapeHtml(outro)}</p>
      `,
    ),
  };
}
