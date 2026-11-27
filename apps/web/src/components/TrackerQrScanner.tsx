import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { parseTrackerImeiFromScan } from "../lib/tracker-scan";
import { Button } from "@atomic-ui/ui-react";
import { ErrorBanner, secondaryBtn } from "./ui";

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
  label = "Scan QR",
}: TrackerQrScanButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        iconBefore="qr-code"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
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
  const regionId = `tracker-qr-${reactId.replace(/:/g, "")}`;
  const callbacksRef = useRef({ onClose, onImei, onError });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  callbacksRef.current = { onClose, onImei, onError };

  useEffect(() => {
    let disposed = false;
    let scanner: Html5Qrcode | null = null;

    async function startScanner() {
      // React StrictMode mounts twice in dev — wait for the first cleanup cycle.
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (disposed) return;

      const container = document.getElementById(regionId);
      if (!container || container.childElementCount > 0) {
        if (!disposed) setStarting(false);
        return;
      }

      scanner = new Html5Qrcode(regionId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
      });

      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const edge =
                Math.min(viewfinderWidth, viewfinderHeight, 280) * 0.72;
              return { width: edge, height: edge };
            },
          },
          (text) => {
            const imei = parseTrackerImeiFromScan(text);
            if (!imei) {
              const message =
                "That code did not contain a valid IMEI. Point at the TAT140 sticker QR.";
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
        const message =
          err instanceof Error
            ? err.message
            : "Could not open the camera. Check browser permissions.";
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
    <div
      className="tracker-qr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Scan tracker QR code"
    >
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
        <div className="relative">
          <div
            id={regionId}
            className="tracker-qr-viewfinder overflow-hidden rounded-xl"
          />
          {starting ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-ink/35 text-sm font-semibold text-paper">
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
    </div>
  );
}
