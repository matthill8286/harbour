import { composeCustomerEmail } from './customer-email';

const context = {
  customerName: 'Maria',
  brandName: 'Demo Imports',
  portalUrl: 'http://localhost:5173/portal',
};

describe('composeCustomerEmail', () => {
  it('builds a portal invite with the invite URL', () => {
    const email = composeCustomerEmail(
      {
        type: 'PORTAL_INVITE',
        message: 'ignored',
        inviteUrl: 'http://localhost:5173/invite/tok_abc',
      },
      context,
    );

    expect(email.subject).toContain('Demo Imports');
    expect(email.text).toContain('http://localhost:5173/invite/tok_abc');
    expect(email.html).toContain('http://localhost:5173/invite/tok_abc');
    expect(email.html).toContain('Set your password');
  });

  it('includes job reference on status updates', () => {
    const email = composeCustomerEmail(
      {
        type: 'JOB_STATUS',
        message: 'Your vehicle is now: In transit',
        jobReference: 'CY-2026-00421',
      },
      context,
    );

    expect(email.subject).toBe('Update on your vehicle (CY-2026-00421)');
    expect(email.text).toContain('Your vehicle is now: In transit');
    expect(email.text).toContain(context.portalUrl);
  });

  it('escapes note HTML', () => {
    const email = composeCustomerEmail(
      {
        type: 'CUSTOMER_NOTE',
        message: '<script>alert(1)</script> Customs cleared',
        jobReference: 'CY-1',
      },
      context,
    );

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain('<script>alert(1)</script> Customs cleared');
  });

  it('builds a file shared notice', () => {
    const email = composeCustomerEmail(
      {
        type: 'FILE_SHARED',
        message: 'A document was shared: invoice.pdf',
      },
      context,
    );

    expect(email.subject).toContain('file was shared');
    expect(email.text).toContain('invoice.pdf');
  });
});
