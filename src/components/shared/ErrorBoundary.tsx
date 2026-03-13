import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.fallbackTitle ? ` - ${this.props.fallbackTitle}` : ''}]`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ borderColor: 'var(--danger)', borderWidth: 1, borderStyle: 'solid' }}>
          <div style={{ textAlign: 'center', padding: 16 }}>
            <p style={{ fontSize: 24, marginBottom: 8 }}>⚠️</p>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {this.props.fallbackTitle || 'Something went wrong'}
            </p>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button className="btn btn-secondary btn-sm" onClick={this.handleRetry}>
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
