import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ErrorBoundary } from './ErrorBoundary';

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-svh bg-sand text-ink">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="block">
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
      <div className="mx-auto max-w-6xl px-4 py-6">
        <main className="min-w-0 flex-1">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
