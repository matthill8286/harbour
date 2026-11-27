import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, useEffect, type ReactNode } from 'react';
import { canManageOrganisation, canWriteStaff, isPortalRole, isStaffRole, type PublicUser } from '@vip/shared';
import { homePath, useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoadingScreen } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyPage } from './components/lazyPage';
import { pageTitle } from './lib/page-title';

const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const JobsPage = lazyPage(() => import('./pages/JobsPage'), 'JobsPage');
const JobNewPage = lazyPage(() => import('./pages/JobNewPage'), 'JobNewPage');
const JobDetailPage = lazyPage(() => import('./pages/JobDetailPage'), 'JobDetailPage');
const CustomersPage = lazyPage(() => import('./pages/CustomersPage'), 'CustomersPage');
const CustomerDetailPage = lazyPage(() => import('./pages/CustomerDetailPage'), 'CustomerDetailPage');
const InvitePage = lazyPage(() => import('./pages/InvitePage'), 'InvitePage');
const PortalPage = lazyPage(() => import('./pages/PortalPage'), 'PortalPage');
const PortalJobPage = lazyPage(() => import('./pages/PortalJobPage'), 'PortalJobPage');
const TrackingPage = lazyPage(() => import('./pages/TrackingPage'), 'TrackingPage');
const TrackersPage = lazyPage(() => import('./pages/TrackersPage'), 'TrackersPage');
const RoutesPage = lazyPage(() => import('./pages/routes/RoutesPage'), 'RoutesPage');
const OrganisationPage = lazyPage(() => import('./pages/OrganisationPage'), 'OrganisationPage');
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'), 'NotFoundPage');
const MorePage = lazyPage(() => import('./pages/MorePage'), 'MorePage');
const TwoFactorPage = lazyPage(() => import('./pages/TwoFactorPage'), 'TwoFactorPage');
const SecuritySetupPage = lazyPage(() => import('./pages/SecuritySetupPage'), 'SecuritySetupPage');
const SecurityPage = lazyPage(() => import('./pages/SecurityPage'), 'SecurityPage');
const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
const SignupPage = lazyPage(() => import('./pages/SignupPage'), 'SignupPage');
const SignupConfirmPage = lazyPage(() => import('./pages/SignupConfirmPage'), 'SignupConfirmPage');

function Guard({ children, allow }: { children: ReactNode; allow: (user: PublicUser) => boolean }) {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingScreen label="Opening workspace…" />;
  if (!user) return <Navigate to="/login" replace />;
  // Staff set up two-factor sign-in before they see any workspace data, as in Kleidi.
  if (isStaffRole(user.role) && !user.twoFactorEnabled) {
    return <Navigate to="/security/setup" replace />;
  }
  if (!allow(user)) {
    return <Navigate to={homePath(user)} replace />;
  }
  return children;
}

const staff = (user: PublicUser) => isStaffRole(user.role);
const staffWrite = (user: PublicUser) => canWriteStaff(user.role);
const manager = (user: PublicUser) => canManageOrganisation(user.role);
const customer = (user: PublicUser) => isPortalRole(user.role);

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pageTitle(pathname);
  }, [pathname]);

  // Signed-in pages have their own boundary inside the shell, which keeps the navigation up.
  return (
    <ErrorBoundary fullPage resetKey={pathname}>
      <Suspense fallback={<PublicLoading />}>
        <AppRoutes />
      </Suspense>
    </ErrorBoundary>
  );
}

function PublicLoading() {
  return (
    <div className="flex min-h-svh justify-center">
      <LoadingScreen />
    </div>
  );
}

/** The signed-out pages share one main landmark. The app shell brings its own. */
function PublicFrame() {
  return (
    <main>
      <Outlet />
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicFrame />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/two-factor" element={<TwoFactorPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/security/setup" element={<SecuritySetupPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/confirm/:token" element={<SignupConfirmPage />} />
      </Route>
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
          path="/jobs"
          element={
            <Guard allow={staff}>
              <JobsPage />
            </Guard>
          }
        />
        <Route
          path="/jobs/new"
          element={
            <Guard allow={staffWrite}>
              <JobNewPage />
            </Guard>
          }
        />
        <Route
          path="/jobs/:id"
          element={
            <Guard allow={staff}>
              <JobDetailPage />
            </Guard>
          }
        />
        <Route
          path="/tracking"
          element={
            <Guard allow={staff}>
              <TrackingPage />
            </Guard>
          }
        />
        <Route
          path="/trackers"
          element={
            <Guard allow={staff}>
              <TrackersPage />
            </Guard>
          }
        />
        <Route
          path="/customers"
          element={
            <Guard allow={staff}>
              <CustomersPage />
            </Guard>
          }
        />
        <Route
          path="/customers/:id"
          element={
            <Guard allow={staff}>
              <CustomerDetailPage />
            </Guard>
          }
        />
        <Route
          path="/organisation"
          element={
            <Guard allow={manager}>
              <OrganisationPage />
            </Guard>
          }
        />
        <Route
          path="/organisation/routes"
          element={
            <Guard allow={manager}>
              <RoutesPage />
            </Guard>
          }
        />
        <Route
          path="/portal"
          element={
            <Guard allow={customer}>
              <PortalPage />
            </Guard>
          }
        />
        <Route
          path="/portal/:id"
          element={
            <Guard allow={customer}>
              <PortalJobPage />
            </Guard>
          }
        />
        <Route
          path="/more"
          element={
            <Guard allow={staff}>
              <MorePage />
            </Guard>
          }
        />
        <Route
          path="/security"
          element={
            <Guard allow={() => true}>
              <SecurityPage />
            </Guard>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
