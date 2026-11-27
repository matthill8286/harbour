import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell as Shell, Avatar, Button, SideNav, TabBar, Text, TextInput } from '@atomic-ui/ui-react';
import type { ShellNavItem } from '@atomic-ui/ui';
import harbourMark from '../assets/harbour-mark.svg';
import { useAuth } from '../lib/auth';
import { useAppLinks } from '../lib/links';
import { useSession } from '../lib/session';
import { ErrorBoundary } from './ErrorBoundary';
import { PhoneHeaderSlot } from '../lib/phone-header';
import './AppShell.css';

/** The owner's places, in the order of the Figma sidebar. */
function staffItems(canManage: boolean): ShellNavItem[] {
  return [
    { id: 'board', label: 'Board', href: '/', icon: 'grid' },
    { id: 'jobs', label: 'Jobs', href: '/jobs', icon: 'clipboard' },
    { id: 'map', label: 'Live map', href: '/tracking', icon: 'map-pinned' },
    { id: 'customers', label: 'Customers', href: '/customers', icon: 'users' },
    { id: 'trackers', label: 'Trackers', href: '/trackers', icon: 'radio' },
    ...(canManage ? [{ id: 'workspace', label: 'Workspace', href: '/organisation', icon: 'settings' }] : []),
    { id: 'account', label: 'Account', href: '/security', icon: 'user' },
  ];
}

/** On a phone the four most used places, and More for the rest. */
const STAFF_TABS: ShellNavItem[] = [
  { id: 'board', label: 'Board', href: '/', icon: 'grid' },
  { id: 'jobs', label: 'Jobs', href: '/jobs', icon: 'clipboard' },
  { id: 'map', label: 'Map', href: '/tracking', icon: 'map-pinned' },
  { id: 'more', label: 'More', href: '/more', icon: 'more' },
];

const PORTAL_ITEMS: ShellNavItem[] = [
  { id: 'vehicles', label: 'Your vehicles', href: '/portal', icon: 'home' },
  { id: 'account', label: 'Account', href: '/security', icon: 'user' },
];

/** The places reached through More on a phone, so More stays marked on them. */
const MORE_PATHS = ['/more', '/customers', '/trackers', '/organisation', '/security'];

export function AppShell() {
  const { logout } = useAuth();
  const { user, isStaff, isPortal, canWrite, canManage, workspace, roleLabel } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [phoneHeader, setPhoneHeader] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  useAppLinks();

  const sideItems = useMemo(() => (isPortal ? PORTAL_ITEMS : staffItems(canManage)), [canManage, isPortal]);
  const tabItems = isPortal ? PORTAL_ITEMS : STAFF_TABS;
  const here = location.pathname;
  const tabCurrent = !isPortal && MORE_PATHS.some((path) => here === path || here.startsWith(`${path}/`)) ? '/more' : here;

  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const slot = useMemo(() => ({ element: phoneHeader, claim }), [phoneHeader, claim]);

  const route = (event: CustomEvent<{ href: string }>) => {
    event.preventDefault();
    navigate(event.detail.href);
  };

  const signOut = () => {
    logout();
    navigate('/login');
  };

  const runSearch = (value: string) => {
    const query = value.trim();
    navigate(query ? `/jobs?search=${encodeURIComponent(query)}` : '/jobs');
  };

  return (
    <Shell className="harbour-shell">
      <Link slot="brand" to={isPortal ? '/portal' : '/'} className="harbour-brand" aria-label="Harbour, home">
        <img src={harbourMark} alt="" width={48} height={48} />
        <span aria-hidden="true">harbour</span>
      </Link>

      <SideNav slot="nav" label="Main" items={sideItems} current={here} onNavigate={route}>
        <Button slot="footer" variant="ghost" iconBefore="log-out" full onClick={signOut}>
          Sign out
        </Button>
      </SideNav>

      <div slot="workspace" className="harbour-chip">
        <Avatar fullName={workspace} size="sm" />
        <span>
          <strong>{workspace}</strong>
          <small>{isPortal ? 'Customer portal' : 'Harbour workspace'}</small>
        </span>
      </div>

      {isStaff ? (
        <div slot="search" role="search" className="harbour-search">
          <TextInput
            type="search"
            label="Search jobs"
            hideLabel
            placeholder="Search reference, customer or plate"
            value={search}
            onChange={(event) => setSearch(event.detail.value)}
            onKeyDown={(event) => {
              // The field's own value, so a search never runs on a state update that has not landed yet.
              if (event.key === 'Enter') runSearch((event.currentTarget as HTMLElement & { value: string }).value);
            }}
          />
        </div>
      ) : null}

      <div slot="actions" className="harbour-actions">
        {isStaff && canWrite ? (
          <Button href="/jobs/new" iconBefore="plus">
            New job
          </Button>
        ) : null}
        <Link to="/security" className="harbour-chip harbour-account">
          <Avatar fullName={user?.name ?? ''} size="sm" />
          <span>
            <strong>{user?.name}</strong>
            <small>{roleLabel}</small>
          </span>
        </Link>
      </div>

      <div slot="phone-header" className="harbour-phone-header">
        <div ref={setPhoneHeader} />
        {claims === 0 ? (
          <div className="harbour-phone-default">
            <Avatar fullName={workspace} size="sm" />
            <span>
              <strong>{workspace}</strong>
              <small>
                {user?.name} · {roleLabel}
              </small>
            </span>
          </div>
        ) : null}
      </div>

      {isStaff && !canWrite ? (
        <Text size="sm" tone="muted" className="harbour-view-only">
          View access. You can look through this workspace, but not change jobs, trackers or customers.
        </Text>
      ) : null}

      <PhoneHeaderSlot.Provider value={slot}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </PhoneHeaderSlot.Provider>

      <TabBar slot="tab-bar" label="Main" items={tabItems} current={tabCurrent} onNavigate={route} />
    </Shell>
  );
}
