/**
 * Keeps one broken page from blanking the whole site: the error is shown in
 * place of the page, and navigating anywhere else resets it.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Changing this (the route) clears the error. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // React already reports the error; keep the component stack next to it for debugging.
    if (info.componentStack) console.warn('Undercut page error', error.message, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice notice-error" role="alert">
        <span className="icon" aria-hidden="true">
          !
        </span>
        <div className="stack" style={{ gap: 8 }}>
          <div>
            <strong>This page hit a problem.</strong> {this.state.error.message}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => location.reload()}>
              Reload
            </button>
            <a className="btn btn-sm btn-ghost" href="#/">
              Back to the pit wall
            </a>
          </div>
        </div>
      </div>
    );
  }
}
