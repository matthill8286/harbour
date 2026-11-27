import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ChunkLoadError } from '../lib/chunk-load';
import { ErrorBanner, secondaryBtn } from './ui';

type Props = {
  children: ReactNode;
  /** Set on pages outside the app shell, so the message is not left in a bare corner. */
  fullPage?: boolean;
  /** When this changes, as on moving to another page, the failed view is cleared. */
  resetKey?: string;
};
type State = { error: unknown; failed: boolean };

/** Shows a plain message when a view fails. The error itself goes to the console only. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ error: null, failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const message =
      this.state.error instanceof ChunkLoadError
        ? 'This page did not load. Check your connection, then reload.'
        : 'Something went wrong on this page. Reload to try again.';
    const body = (
      <div className="space-y-3">
        <ErrorBanner message={message} />
        <button type="button" className={secondaryBtn} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
    if (!this.props.fullPage) return body;
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="display text-3xl">Harbour</h1>
        {body}
      </main>
    );
  }
}
