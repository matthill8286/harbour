import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ErrorBanner, fieldClass, primaryBtn } from '../components/ui';

export function LoginPage() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@demo-imports.local');
  const [password, setPassword] = useState('ChangeMe!Admin1');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && user) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const signedIn = await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-svh bg-ink text-paper">
      <div className="mx-auto grid min-h-svh max-w-5xl md:grid-cols-2">
        <section className="hidden flex-col justify-between p-10 md:flex">
          <p className="text-xs uppercase tracking-[0.28em] text-mist">UK → EU → Greece → Cyprus</p>
          <div>
            <h1 className="display text-5xl leading-tight">Harbour</h1>
            <p className="mt-4 max-w-sm text-mist">
              The import job is the work. The vehicle is the asset. Track every crossing without
              mixing customer updates and internal margin.
            </p>
          </div>
          <p className="text-sm text-mist">Demo organisation: Demo Imports Ltd</p>
        </section>
        <section className="flex items-center bg-sand p-6 text-ink md:p-12">
          <form onSubmit={onSubmit} className="w-full max-w-md space-y-4">
            <p className="display text-lg md:hidden">Harbour</p>
            <h2 className="display text-3xl">Sign in</h2>
            <label className="block text-sm font-semibold">
              Email
              <input
                className={`${fieldClass} mt-1`}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                type="password"
                className={`${fieldClass} mt-1`}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error ? <ErrorBanner message={error} /> : null}
            <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
              {pending ? 'Signing in…' : 'Enter desk'}
            </button>
            <p className="text-xs text-ink/60">
              Staff: admin@demo-imports.local / ChangeMe!Admin1
              <br />
              Customer: customer@example.com / ChangeMe!Customer1
              <br />
              New customers use the invite link from their importer.
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
