import { Component, type ErrorInfo, type ReactNode } from 'react';
import { secondaryBtn } from './ui';

/** Keeps a map failure inside the map's own box, so the rest of the page stays usable. */
export class MapBoundary extends Component<{ children: ReactNode; className: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={`flex flex-col items-center justify-center gap-3 bg-mist/50 p-4 text-center text-sm ${this.props.className}`}>
        <p>The map did not load. Reload the page to try again.</p>
        <button type="button" className={secondaryBtn} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
