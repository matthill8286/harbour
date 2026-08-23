import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, MapPinned, Ship, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ErrorBoundary } from './ErrorBoundary';

const staffLinks = [
  { to: '/', label: 'Board', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: Ship },
  { to: '/tracking', label: 'Map', icon: MapPinned },
  { to: '/customers', label: 'Customers', icon: Users },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const links = isStaff
    ? staffLinks
    : [{ to: '/portal', label: 'My vehicle', icon: Ship }];

  return (
    <div className="min-h-svh bg-sand text-ink">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <NavLink to={isStaff ? '/' : '/portal'} className="block">
            <p className="display text-lg leading-none">Harbour</p>
            <p className="text-[11px] uppercase tracking-[0.22em] text-mist">
              {user?.organisationName ?? 'Vehicle import desk'}
            </p>
          </NavLink>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-mist">{user?.name}</span>
            <button
              type="button"
              className="rounded-full border border-paper/30 px-3 py-1 text-sm hover:bg-paper/10"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 pb-24 md:pb-8">
        <nav className="hidden w-48 shrink-0 md:block">
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.to === '/' || link.to === '/portal'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                      isActive ? 'bg-ink text-paper' : 'text-ink/70 hover:bg-paper'
                    }`
                  }
                >
                  <link.icon size={16} />
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-ink/10 bg-paper md:hidden">
        <ul className={`grid ${links.length === 1 ? 'grid-cols-1' : 'grid-cols-4'}`}>
          {links.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === '/' || link.to === '/portal'}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 py-2 text-[11px] font-semibold ${
                    isActive ? 'text-harbour' : 'text-ink/50'
                  }`
                }
              >
                <link.icon size={18} />
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
