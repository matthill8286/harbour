export type CustomerEmailEventType =
  'JOB_STATUS' | 'CUSTOMER_NOTE' | 'FILE_SHARED' | 'PORTAL_INVITE';

export type CustomerEmailEvent = {
  type: CustomerEmailEventType;
  message: string;
  inviteUrl?: string;
  jobReference?: string | null;
};

export type CustomerEmailContext = {
  customerName: string;
  brandName: string;
  portalUrl: string;
};

export type ComposedCustomerEmail = {
  subject: string;
  text: string;
  html: string;
};

export function composeCustomerEmail(
  event: CustomerEmailEvent,
  context: CustomerEmailContext,
): ComposedCustomerEmail {
  const greeting = `Hi ${context.customerName},`;
  const signOff = `— ${context.brandName}`;
  const jobBit = event.jobReference ? ` (${event.jobReference})` : '';

  switch (event.type) {
    case 'PORTAL_INVITE': {
      const url = event.inviteUrl ?? context.portalUrl;
      const subject = `You're invited to track your import with ${context.brandName}`;
      const text = [
        greeting,
        '',
        `${context.brandName} has invited you to the customer portal.`,
        `Open this link to set your password and view your vehicle:`,
        url,
        '',
        'This link expires. If it no longer works, ask your importer for a new invite.',
        '',
        signOff,
      ].join('\n');
      const html = wrapHtml(
        context.brandName,
        subject,
        `
          <p>${escapeHtml(greeting)}</p>
          <p>${escapeHtml(context.brandName)} has invited you to the customer portal.</p>
          <p><a href="${escapeHtml(url)}">Set your password and open the portal</a></p>
          <p style="color:#666;font-size:14px">This link expires. If it no longer works, ask your importer for a new invite.</p>
          <p>${escapeHtml(signOff)}</p>
        `,
      );
      return { subject, text, html };
    }
    case 'JOB_STATUS': {
      const subject = `Update on your vehicle${jobBit}`;
      const text = [
        greeting,
        '',
        event.message,
        '',
        `View progress anytime: ${context.portalUrl}`,
        '',
        signOff,
      ].join('\n');
      const html = wrapHtml(
        context.brandName,
        subject,
        `
          <p>${escapeHtml(greeting)}</p>
          <p>${escapeHtml(event.message)}</p>
          <p><a href="${escapeHtml(context.portalUrl)}">View your import</a></p>
          <p>${escapeHtml(signOff)}</p>
        `,
      );
      return { subject, text, html };
    }
    case 'CUSTOMER_NOTE': {
      const subject = `A note on your import${jobBit}`;
      const text = [
        greeting,
        '',
        `${context.brandName} left a note:`,
        event.message,
        '',
        `Open the portal: ${context.portalUrl}`,
        '',
        signOff,
      ].join('\n');
      const html = wrapHtml(
        context.brandName,
        subject,
        `
          <p>${escapeHtml(greeting)}</p>
          <p>${escapeHtml(context.brandName)} left a note:</p>
          <blockquote style="margin:12px 0;padding:12px 16px;background:#f6f4ef;border-radius:8px">${escapeHtml(event.message)}</blockquote>
          <p><a href="${escapeHtml(context.portalUrl)}">Open the portal</a></p>
          <p>${escapeHtml(signOff)}</p>
        `,
      );
      return { subject, text, html };
    }
    case 'FILE_SHARED': {
      const subject = `A file was shared on your import${jobBit}`;
      const text = [
        greeting,
        '',
        event.message,
        '',
        `Download it from the portal: ${context.portalUrl}`,
        '',
        signOff,
      ].join('\n');
      const html = wrapHtml(
        context.brandName,
        subject,
        `
          <p>${escapeHtml(greeting)}</p>
          <p>${escapeHtml(event.message)}</p>
          <p><a href="${escapeHtml(context.portalUrl)}">Open shared files</a></p>
          <p>${escapeHtml(signOff)}</p>
        `,
      );
      return { subject, text, html };
    }
  }
}

function wrapHtml(brandName: string, title: string, body: string) {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
    <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#888;margin:0 0 16px">${escapeHtml(brandName)}</p>
    <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
    ${body}
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
