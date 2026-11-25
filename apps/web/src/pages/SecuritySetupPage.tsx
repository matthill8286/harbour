import { Navigate, useNavigate } from 'react-router-dom';
import { homePath, useAuth } from '../lib/auth';
import { AuthFrame } from '../components/AuthFrame';
import { TwoFactorEnrolment } from '../components/TwoFactorEnrolment';
import { LoadingScreen } from '../components/ui';

/** Staff land here after their first sign-in, and cannot open the workspace until it is done. */
export function SecuritySetupPage() {
  const { user, ready, refresh, logout } = useAuth();
  const navigate = useNavigate();

  if (!ready) return <LoadingScreen label="Opening workspace…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.twoFactorEnabled) return <Navigate to={homePath(user)} replace />;

  return (
    <AuthFrame
      eyebrow="Account security"
      lead="Harbour holds customer and vehicle records, so every team member signs in with a password and a code from an authenticator app."
    >
      <h2 className="display text-3xl">Set up two-factor sign-in</h2>
      <p className="text-sm text-ink/60">
        You need an authenticator app on your phone. This takes about a minute.
      </p>
      <TwoFactorEnrolment
        onEnabled={async () => {
          const updated = await refresh();
          if (updated) navigate(homePath(updated), { replace: true });
        }}
      />
      <button
        type="button"
        className="text-sm text-ink/60"
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
