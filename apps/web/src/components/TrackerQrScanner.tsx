import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { parseTrackerImeiFromScan } from '../lib/tracker-scan';
import { cameraMessage } from '../lib/errors';
import { Button } from '@atomic-ui/ui-react';
import { ErrorBanner, secondaryBtn } from './ui';

type TrackerQrScanButtonProps = {
  onImei: (imei: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  label?: string;
};

export function TrackerQrScanButton({ onImei, onError, disabled = false, label = 'Scan QR' }: TrackerQrScanButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" iconBefore="qr-code" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <TrackerQrScannerDialog onClose={() => setOpen(false)} onImei={onImei} onError={onError} /> : null}
    </>
  );
}

function TrackerQrScannerDialog({ onClose, onImei, onError }: { onClose: () => void; onImei: (imei: string) => void; onError?: (message: string) => void }) {
  const reactId = useId();
  const regionId = `tracker-qr-${reactId.replace(/:/g, '')}`;
  const callbacksRef = useRef({ onClose, onImei, onError });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // A modal dialog keeps the keyboard inside it and sits above the form that opened it.
  // Closing it hands the focus back to where it was, which works only while it is still
  // on the page, so this is a layout effect.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  callbacksRef.current = { onClose, onImei, onError };

  useEffect(() => {
    let disposed = false;
    let scanner: Html5Qrcode | null = null;

    async function startScanner() {
      // React StrictMode mounts twice in dev — wait for the first cleanup cycle.
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (disposed) return;

      // The scanner library is large, so it is fetched only when the camera is opened.
      // A failure does not reload the tab, because the form behind may be half typed.
      let library: typeof import('html5-qrcode');
      try {
        library = await import('html5-qrcode');
      } catch {
        if (disposed) return;
        const message = 'The scanner did not load. Type the IMEI instead, or reload the page and try again.';
        setError(message);
        callbacksRef.current.onError?.(message);
        setStarting(false);
        return;
      }
      if (disposed) return;
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = library;

      const container = document.getElementById(regionId);
      if (!container || container.childElementCount > 0) {
        if (!disposed) setStarting(false);
        return;
      }

      scanner = new Html5Qrcode(regionId, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128],
      });

      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const edge = Math.min(viewfinderWidth, viewfinderHeight, 280) * 0.72;
              return { width: edge, height: edge };
            },
          },
          (text) => {
            const imei = parseTrackerImeiFromScan(text);
            if (!imei) {
              const message = 'That code did not contain a valid IMEI. Point at the TAT140 sticker QR.';
              setError(message);
              callbacksRef.current.onError?.(message);
              return;
            }
            void scanner?.stop().finally(() => {
              scanner?.clear();
              if (!disposed) {
                callbacksRef.current.onImei(imei);
                callbacksRef.current.onClose();
              }
            });
          },
          () => {},
        );
        if (!disposed) setStarting(false);
      } catch (err: unknown) {
        if (disposed) return;
        console.error(err);
        const message = cameraMessage(err);
        setError(message);
        callbacksRef.current.onError?.(message);
        setStarting(false);
      }
    }

    void startScanner();

    return () => {
      disposed = true;
      void (async () => {
        try {
          if (scanner?.isScanning) await scanner.stop();
        } catch {
          // Camera may already be released.
        }
        try {
          scanner?.clear();
        } catch {
          // Container may already be cleared.
        }
      })();
    };
  }, [regionId]);

  return (
    <dialog
      ref={dialogRef}
      className="tracker-qr-overlay"
      aria-label="Scan tracker QR code"
      // Escape closes the scanner only, not the dialog it was opened from.
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="tracker-qr-panel rounded-2xl bg-paper p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="display text-2xl">Scan tracker QR</h2>
            <p className="mt-1 text-sm text-ink/70">Point your camera at the IMEI QR on the Teltonika TAT140 sticker.</p>
          </div>
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="relative">
          <div id={regionId} className="tracker-qr-viewfinder overflow-hidden rounded-xl" />
          {starting ? (
            <p
              role="status"
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-ink/35 text-sm font-semibold text-paper"
            >
              Opening camera…
            </p>
          ) : null}
        </div>
        {error ? (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
