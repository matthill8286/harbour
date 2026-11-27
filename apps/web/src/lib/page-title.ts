const TITLES: Array<[RegExp, string]> = [
  [/^\/login$/, 'Sign in'],
  [/^\/invite\//, 'Your invitation'],
  [/^\/two-factor$/, 'Two-factor sign-in'],
  [/^\/forgot-password$/, 'Forgot your password'],
  [/^\/reset-password\//, 'Reset your password'],
  [/^\/security\/setup$/, 'Set up two-factor sign-in'],
  [/^\/signup$/, 'Create a workspace'],
  [/^\/signup\/confirm\//, 'Confirm your workspace'],
  [/^\/$/, 'Board'],
  [/^\/jobs$/, 'Jobs'],
  [/^\/jobs\/new$/, 'New job'],
  [/^\/jobs\/[^/]+$/, 'Job'],
  [/^\/tracking$/, 'Live map'],
  [/^\/trackers$/, 'Trackers'],
  [/^\/customers$/, 'Customers'],
  [/^\/customers\/[^/]+$/, 'Customer'],
  [/^\/organisation$/, 'Workspace'],
  [/^\/organisation\/routes$/, 'Routes'],
  [/^\/portal$/, 'Your vehicles'],
  [/^\/portal\/[^/]+$/, 'Your vehicle'],
  [/^\/more$/, 'More'],
  [/^\/security$/, 'Account and security'],
];

/** The browser tab's title, which also tells a screen reader which page this is. */
export function pageTitle(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const name = TITLES.find(([pattern]) => pattern.test(path))?.[1] ?? 'Page not found';
  return `${name} — Harbour`;
}
