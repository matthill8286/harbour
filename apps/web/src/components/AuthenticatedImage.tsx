import { useEffect, useState } from 'react';
import { apiBlob } from '../lib/api';

export function AuthenticatedImage({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    void apiBlob(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-sand text-xs text-ink/45 ${className ?? ''}`}>
        Photo unavailable
      </div>
    );
  }
  if (!src) {
    return <div className={`animate-pulse bg-mist ${className ?? ''}`} aria-hidden />;
  }
  return <img src={src} alt={alt} className={className} />;
}
