import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api, setToken, type SessionResponse, type TwoFactorSetup } from '../lib/api';
import { ErrorBanner, fieldClass, primaryBtn } from './ui';
import { BackupCodeList } from './BackupCodeList';

type Setup = TwoFactorSetup & { qr: string };

/**
 * The setup flow ported from Kleidi: confirm the password, scan the QR code (or type the
 * secret), save the backup codes, then enter a code to prove the authenticator works.
 */
export function TwoFactorEnrolment({ onEnabled }: { onEnabled: () => Promise<void> | void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<TwoFactorSetup>('/auth/two-factor/enable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      const qr = await QRCode.toDataURL(result.totpURI, { margin: 1, width: 200 });
      setPassword('');
      setSetup({ ...result, qr });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup');
    } finally {
      setPending(false);
    }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/auth/two-factor/verify', {
        method: 'POST',
        body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      });
      // Turning two-factor on ends every older session, so this device takes the new one.
      setToken(session.accessToken);
      await onEnabled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not right.');
    } finally {
      setPending(false);
    }
  }

  if (!setup) {
    return (
      <form onSubmit={start} className="space-y-4">
        <label className="block text-sm font-semibold">
          Confirm your password
          <input
            type="password"
            className={`${fieldClass} mt-1`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <ErrorBanner message={error} /> : null}
        <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
          {pending ? 'Starting…' : 'Set up authenticator'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={activate} className="space-y-4">
      <div className="grid justify-items-center gap-3 rounded-2xl bg-paper p-4 text-center">
        <p className="text-sm text-ink/60">Scan this QR code with an authenticator app such as 1Password, Google Authenticator or Microsoft Authenticator.</p>
        <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} />
        <p className="text-xs text-ink/55">Or type this key into the app</p>
        <code className="break-all rounded-lg bg-sand px-3 py-1.5 font-mono text-xs">{setup.secret}</code>
      </div>
      <div className="rounded-2xl bg-paper p-4">
        <h3 className="font-semibold">Save your backup codes</h3>
        <p className="mt-1 text-sm text-ink/60">Keep these somewhere safe. If you lose your phone, each code signs you in once.</p>
        <BackupCodeList codes={setup.backupCodes} />
      </div>
      <label className="block text-sm font-semibold">
        Enter the 6-digit code from the app
        <input
          className={`${fieldClass} mt-1 font-mono tracking-widest`}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          placeholder="123 456"
          required
          autoFocus
        />
      </label>
      {error ? <ErrorBanner message={error} /> : null}
      <button type="submit" disabled={pending} className={`${primaryBtn} w-full py-3`}>
        {pending ? 'Checking…' : 'Turn on two-factor sign-in'}
      </button>
    </form>
  );
}
