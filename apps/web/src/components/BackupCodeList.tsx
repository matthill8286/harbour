import { useState } from 'react';
import { Button } from '@atomic-ui/ui-react';
import './BackupCodeList.css';

/** Freshly made backup codes, two to a row, with a button that copies them all. */
export function BackupCodeList({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="backup-codes">
      <ul aria-label="Backup codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        iconBefore={copied ? 'check' : 'document'}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(codes.join('\n'))
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? 'Copied' : 'Copy codes'}
      </Button>
    </div>
  );
}
