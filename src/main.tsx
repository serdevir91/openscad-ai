import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App runtime error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          fontFamily: 'Segoe UI, sans-serif',
          background: '#111519',
          color: '#dce0e5',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center'
        }}>
          <h2 style={{ color: '#f6a45c', marginBottom: 12 }}>Application startup error</h2>
          <p style={{ maxWidth: 600, color: '#84909d', lineHeight: 1.6, fontSize: 13, background: '#181d23', padding: 16, borderRadius: 8, border: '1px solid #2c333b' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              background: '#f6a45c',
              color: '#111519',
              border: 'none',
              borderRadius: 6,
              padding: '10px 20px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Restart
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
