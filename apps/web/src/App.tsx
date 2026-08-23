import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { PublicUser } from '@vip/shared';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { JobNewPage } from './pages/JobNewPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { CustomersPage } from './pages/CustomersPage';
import { TrackingPage } from './pages/TrackingPage';
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
    return <Navigate to={user.role === 'CUSTOMER' ? '/waiting' : '/'} replace />;
  }
  return children;
}

const staff = (user: PublicUser) => user.role === 'ADMIN' || user.role === 'STAFF';

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
            <Guard allow={staff}>
              <DashboardPage />
            </Guard>
          }
        />
        <Route
          path="/waiting"
          element={
            <p className="rounded-2xl bg-paper p-6 text-ink/80">
              Your importer will send a portal invite when this desk is ready for customers.
            </p>
          }
        />
        <Route path="/jobs" element={<Guard allow={staff}><JobsPage /></Guard>} />
        <Route path="/jobs/new" element={<Guard allow={staff}><JobNewPage /></Guard>} />
        <Route path="/jobs/:id" element={<Guard allow={staff}><JobDetailPage /></Guard>} />
        <Route path="/tracking" element={<Guard allow={staff}><TrackingPage /></Guard>} />
        <Route path="/customers" element={<Guard allow={staff}><CustomersPage /></Guard>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
