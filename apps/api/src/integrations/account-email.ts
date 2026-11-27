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
