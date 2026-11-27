import { useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Alert, Button, Heading, Text, TextInput } from '@atomic-ui/ui-react';
import { api, type TwoFactorSetup } from '../lib/api';
import { BackupCodeList } from './BackupCodeList';
import './TwoFactorEnrolment.css';

type Setup = TwoFactorSetup & { qr: string };
type Step = 'password' | 'scan' | 'codes';

/** "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP", easier to type into an app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * Turning on two-factor sign-in, after the Figma frames "Security setup": confirm
 * the password, scan the QR code (or type the key) and enter a code, then save
 * the backup codes, which are shown only this once. Used at first sign-in and on
 * Account and security.
 */
export function TwoFactorEnrolment({ onEnabled }: { onEnabled: () => Promise<void> | void }) {
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setPending(true);
    setError(null);
    try {
      const result = await api<TwoFactorSetup>('/auth/two-factor/enable', { method: 'POST', body: JSON.stringify({ password }) });
      const qr = await QRCode.toDataURL(result.totpURI, { margin: 1, width: 200 });
      setPassword('');
      setSetup({ ...result, qr });
      setStep('scan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup did not start. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setPending(true);
    setError(null);
    try {
      await api('/auth/two-factor/verify', { method: 'POST', body: JSON.stringify({ code: code.replace(/\s/g, '') }) });
      setStep('codes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not right.');
    } finally {
      setPending(false);
    }
  }

  if (step === 'password' || !setup) {
    return (
      <form className="enrol-form" onSubmit={(event) => void start(event)} noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <TextInput
          label="Confirm your password"
          type="password"
          autocomplete="current-password"
          value={password}
          onChange={(event) => {
            const value = event.detail.value;
            setPassword(value);
          }}
        />
        <Button type="submit" full disabled={!password} busy={pending} busyLabel="Starting setup">
          Set up authenticator
        </Button>
      </form>
    );
  }

  if (step === 'codes') {
    return (
      <div className="enrol">
        <Heading level={2} size="xl">
          Save your backup codes
        </Heading>
        <Text size="sm" tone="muted">
          Each code signs you in once if you lose your phone. They are shown only now.
        </Text>
        <BackupCodeList codes={setup.backupCodes} />
        <Button full onClick={() => void onEnabled()}>
          I saved them, continue
        </Button>
      </div>
    );
  }

  return (
    <form className="enrol-form" onSubmit={(event) => void activate(event)} noValidate>
      <Text size="sm" tone="muted">
        Scan this code with an authenticator app such as 1Password, Google Authenticator or Microsoft Authenticator, then enter the 6-digit code it shows.
      </Text>
      <div className="enrol-scan">
        <img src={setup.qr} alt="QR code for your authenticator app" width={152} height={152} />
        <div>
          <Text size="sm" tone="muted">
            Or type this key into the app
          </Text>
          <code className="enrol-key">{grouped(setup.secret)}</code>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <TextInput
        label="6-digit code"
        inputmode="numeric"
        autocomplete="one-time-code"
        placeholder="123 456"
        value={code}
        onChange={(event) => {
          const value = event.detail.value;
          setCode(value);
        }}
      />
      <Button type="submit" full disabled={!code.trim()} busy={pending} busyLabel="Checking the code">
        Turn on two-factor sign-in
      </Button>
    </form>
  );
}
