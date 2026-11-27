import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { canManageOrganisation, canWriteStaff, isPortalRole, isStaffRole, type PublicUser } from '@vip/shared';
import { homePath, useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { JobNewPage } from './pages/JobNewPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { InvitePage } from './pages/InvitePage';
import { PortalPage } from './pages/PortalPage';
import { PortalJobPage } from './pages/PortalJobPage';
import { TrackingPage } from './pages/TrackingPage';
import { TrackersPage } from './pages/TrackersPage';
import { RoutesPage } from './pages/routes/RoutesPage';
import { OrganisationPage } from './pages/OrganisationPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { MorePage } from './pages/MorePage';
import { TwoFactorPage } from './pages/TwoFactorPage';
import { SecuritySetupPage } from './pages/SecuritySetupPage';
import { SecurityPage } from './pages/SecurityPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SignupPage } from './pages/SignupPage';
import { SignupConfirmPage } from './pages/SignupConfirmPage';
import { LoadingScreen } from './components/ui';

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
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/two-factor" element={<TwoFactorPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/security/setup" element={<SecuritySetupPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/confirm/:token" element={<SignupConfirmPage />} />
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
