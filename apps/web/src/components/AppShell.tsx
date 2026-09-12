import { useMemo, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MoreHorizontal,
  Settings,
  Ship,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useSession } from '../lib/session';
import { ErrorBoundary } from './ErrorBoundary';

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
  group?: string;
};

const staffPrimary: NavItem[] = [
  { to: '/', label: 'Board', icon: LayoutDashboard, end: true, group: 'Today' },
  { to: '/jobs', label: 'Jobs', icon: Ship, group: 'Work' },
];

const staffSecondary: NavItem[] = [
  { to: '/customers', label: 'Customers', icon: Users, group: 'Directory' },
];

export function AppShell() {
  const { logout } = useAuth();
  const { user, isStaff, isPortal, canWrite, canManage, workspace, roleLabel } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const home = isPortal ? '/portal' : '/';
  const fluidMain = isStaff && location.pathname.startsWith('/jobs/');

  const railLinks = useMemo((): NavItem[] => {
    if (isPortal) {
      return [{ to: '/portal', label: 'My vehicle', icon: Ship, end: true }];
    }
    const links: NavItem[] = [...staffPrimary, ...staffSecondary];
    if (canManage) {
      links.push({ to: '/organisation', label: 'Workspace', icon: Settings, group: 'Admin' });
    }
    return links;
  }, [canManage, isPortal]);

  const mobilePrimary: NavItem[] = isPortal
    ? railLinks
    : [...staffPrimary, { to: '#more', label: 'More', icon: MoreHorizontal }];

  const moreLinks = useMemo(() => {
    if (isPortal) return [];
    const links = [...staffSecondary];
    if (canManage) {
      links.push({ to: '/organisation', label: 'Workspace', icon: Settings, group: 'Admin' });
    }
    return links;
  }, [canManage, isPortal]);

  const groupedRail = useMemo(() => {
    const groups: Array<{ label: string; items: NavItem[] }> = [];
    for (const link of railLinks) {
      const label = link.group ?? '';
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(link);
      } else {
        groups.push({ label, items: [link] });
      }
    }
    return groups;
  }, [railLinks]);

  return (
    <div className="staff-shell">
      <header className="staff-header">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5">
          <NavLink to={home} className="block min-w-0">
            <p className="display truncate text-lg leading-none text-paper">{workspace}</p>
            <p className="text-[11px] uppercase tracking-[0.22em] text-mist">
              {isPortal ? 'Customer portal · Harbour' : 'Harbour workspace'}
            </p>
          </NavLink>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {isStaff && canWrite ? (
              <Link
                to="/jobs/new"
                className="hidden rounded-xl bg-harbour px-3 py-1.5 text-sm font-semibold text-paper sm:inline-flex"
              >
                New job
              </Link>
            ) : null}
            <div className="hidden text-right sm:block">
              <p className="text-paper">{user?.name}</p>
              <p className="text-[11px] uppercase tracking-widest text-mist">{roleLabel}</p>
            </div>
            <button
              type="button"
              className="rounded-full border border-paper/30 px-3 py-1 text-sm text-paper hover:bg-paper/10"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        {isStaff && !canWrite ? (
          <p className="border-t border-paper/10 px-4 py-1.5 text-center text-[11px] text-mist">
            View access — you can look through this workspace, not change jobs or customers.
          </p>
        ) : null}
      </header>

      <div className="staff-body">
        <nav className="staff-rail" aria-label="Primary">
          {groupedRail.map((group) => (
            <div key={group.label || group.items[0]?.to} className="staff-rail-group">
              {group.label ? <p className="staff-rail-label">{group.label}</p> : null}
              <ul className="space-y-1">
                {group.items.map((link) => (
                  <li key={link.to}>
                    <NavLink
                      to={link.to}
                      end={link.end}
                      className={({ isActive }) =>
                        `staff-rail-link${isActive ? ' is-active' : ''}`
                      }
                    >
                      <link.icon size={16} />
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className={`staff-main${fluidMain ? ' is-fluid' : ''}`}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav className="staff-mobile-nav" aria-label="Mobile">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobilePrimary.length}, minmax(0, 1fr))` }}>
          {mobilePrimary.map((link) =>
            link.to === '#more' ? (
              <li key="more">
                <button
                  type="button"
                  className={`staff-mobile-link${moreOpen ? ' is-active' : ''}`}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <MoreHorizontal size={18} />
                  More
                </button>
              </li>
            ) : (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) => `staff-mobile-link${isActive ? ' is-active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <link.icon size={18} />
                  {link.label}
                </NavLink>
              </li>
            ),
          )}
        </ul>
      </nav>

      {moreOpen ? (
        <div className="staff-more-sheet" role="dialog" aria-label="More navigation">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-semibold">More</p>
            <button type="button" className="rounded-lg p-1 text-ink/60" onClick={() => setMoreOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <ul className="space-y-1 px-3 pb-4">
            {moreLinks.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold ${
                      isActive ? 'bg-ink text-paper' : 'text-ink/80 hover:bg-sand'
                    }`
                  }
                  onClick={() => setMoreOpen(false)}
                >
                  <link.icon size={16} />
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
