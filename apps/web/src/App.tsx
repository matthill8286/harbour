import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { PublicUser } from '@vip/shared';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { LoadingScreen } from './components/ui';

function Guard({
  children,
  allow,
}: {
  children: ReactNode;
  allow: (user: PublicUser) => boolean;
}) {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingScreen label="Opening Harbour…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allow(user)) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Guard allow={() => true}>
            <AppShell />
          </Guard>
        }
      >
        <Route
          path="/"
          element={
            <Guard allow={(user) => user.role === 'ADMIN' || user.role === 'STAFF'}>
              <p className="text-sm text-ink/60">Signed in to the Harbour desk.</p>
            </Guard>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
