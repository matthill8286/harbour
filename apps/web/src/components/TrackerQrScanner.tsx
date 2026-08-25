import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { parseTrackerImeiFromScan } from '../lib/tracker-scan';
import { ErrorBanner, secondaryBtn } from './ui';

type TrackerQrScanButtonProps = {
  onImei: (imei: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  label?: string;
};

export function TrackerQrScanButton({
  onImei,
  onError,
  disabled = false,
  label = 'Scan QR',
}: TrackerQrScanButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={secondaryBtn}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <TrackerQrScannerDialog
          onClose={() => setOpen(false)}
          onImei={onImei}
          onError={onError}
        />
      ) : null}
    </>
  );
}

function TrackerQrScannerDialog({
  onClose,
  onImei,
  onError,
}: {
  onClose: () => void;
  onImei: (imei: string) => void;
  onError?: (message: string) => void;
}) {
  const reactId = useId();
  const regionId = `tracker-qr-${reactId.replace(/:/g, '')}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(regionId, {
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
      ],
    });
    scannerRef.current = scanner;
    let cancelled = false;

    void scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
        (text) => {
          const imei = parseTrackerImeiFromScan(text);
          if (!imei) {
            const message = 'That code did not contain a valid IMEI. Point at the TAT140 sticker QR.';
            setError(message);
            onError?.(message);
            return;
          }
          void scanner.stop().finally(() => {
            if (!cancelled) {
              onImei(imei);
              onClose();
            }
          });
        },
        () => {},
      )
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Could not open the camera. Check browser permissions.';
        setError(message);
        onError?.(message);
      });

    return () => {
      cancelled = true;
      const active = scannerRef.current;
      scannerRef.current = null;
      if (active?.isScanning) {
        void active.stop().catch(() => {});
      }
    };
  }, [onClose, onError, onImei, regionId]);

  return (
    <div className="tracker-qr-overlay" role="dialog" aria-modal="true" aria-label="Scan tracker QR code">
      <div className="tracker-qr-panel rounded-2xl bg-paper p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="display text-2xl">Scan tracker QR</h2>
            <p className="mt-1 text-sm text-ink/60">
              Point your camera at the IMEI QR on the Teltonika TAT140 sticker.
            </p>
          </div>
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
        <div id={regionId} className="tracker-qr-viewfinder overflow-hidden rounded-xl" />
        {error ? (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
