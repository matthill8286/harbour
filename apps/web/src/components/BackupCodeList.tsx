import { useState } from 'react';
import { secondaryBtn } from './ui';

export function BackupCodeList({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 space-y-3">
      <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button
        type="button"
        className={secondaryBtn}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(codes.join('\n'))
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? 'Copied' : 'Copy codes'}
      </button>
    </div>
  );
}
