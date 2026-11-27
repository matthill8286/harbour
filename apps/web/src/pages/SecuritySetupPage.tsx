import { Navigate, useNavigate } from 'react-router-dom';
import { Badge, Heading, Text } from '@atomic-ui/ui-react';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';
import { TwoFactorEnrolment } from '../components/TwoFactorEnrolment';
import { LoadingScreen } from '../components/ui';

/**
 * Admins and Staff land here after their first sign-in, and cannot open the
 * workspace until two-factor sign-in is on. After the Figma frames "Security setup".
 */
export function SecuritySetupPage() {
  const { user, ready, refresh, logout } = useAuth();
  const navigate = useNavigate();

  if (!ready) return <LoadingScreen label="Opening workspace…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.twoFactorEnabled) return <Navigate to={homePath(user)} replace />;

  return (
    <AuthFrame>
      <div className="auth-intro">
        <Badge>Required for your team</Badge>
        <Heading level={1} size="3xl" className="auth-title">
          Set up two-factor sign-in
        </Heading>
        <Text tone="muted">
          Harbour holds customer and vehicle records, so everyone on the team signs in with a password and a code from an authenticator app.
        </Text>
      </div>
      <TwoFactorEnrolment
        onEnabled={async () => {
          const updated = await refresh();
          if (updated) navigate(homePath(updated), { replace: true });
        }}
      />
      <button
        type="button"
        className="auth-link auth-switch"
        onClick={() => {
          logout();
          navigate('/login');
        }}
      >
        Sign out
      </button>
    </AuthFrame>
  );
}
