import { composeClosureEmail, formatClosureDate } from './account-email';

describe('closure emails', () => {
  const closure = {
    workspaceName: 'Demo <Imports>',
    contractEndsAt: new Date('2027-01-31T23:59:59.999Z'),
    deleteAfter: new Date('2027-03-02T23:59:59.999Z'),
    workspaceUrl: 'https://harbour.example/organisation',
  };
  const before = new Date('2027-01-15T12:00:00Z');
  const after = new Date('2027-02-10T12:00:00Z');

  it('writes dates in words, in UTC', () => {
    expect(formatClosureDate(closure.contractEndsAt)).toBe('31 January 2027');
  });

  it('says when the contract ends, when the data goes and how to export it', () => {
    const email = composeClosureEmail(
      { ...closure, kind: 'SCHEDULED' },
      before,
    );
    expect(email.subject).toBe(
      'Demo <Imports> will be deleted after 2 March 2027',
    );
    expect(email.text).toContain('ends on 31 January 2027');
    expect(email.text).toContain('After 2 March 2027, all of');
    expect(email.text).toContain('Export all workspace data');
    expect(email.text).toContain(closure.workspaceUrl);
    expect(email.html).toContain('Demo &lt;Imports&gt;');
    expect(email.html).not.toContain('Demo <Imports>');
  });

  it('says the contract ended once it has', () => {
    const email = composeClosureEmail({ ...closure, kind: 'REMINDER' }, after);
    expect(email.subject).toMatch(/^Reminder: /);
    expect(email.text).toContain('ended on 31 January 2027');
    expect(email.text).toContain('If you have not exported the workspace yet');
  });

  it('says a cancelled deletion leaves everything as it is', () => {
    const email = composeClosureEmail({ ...closure, kind: 'CANCELLED' }, after);
    expect(email.subject).toBe('Demo <Imports> will no longer be deleted');
    expect(email.text).toContain('is cancelled');
    expect(email.text).not.toContain(closure.workspaceUrl);
  });
});
