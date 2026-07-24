import React from "react";

const CHUNK_ERROR_KEY = "oc_chunk_reload";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    const isChunk = error?.message?.includes("dynamically imported module") || error?.message?.includes("Loading chunk");

    if (isChunk) {
      const count = parseInt(sessionStorage.getItem(CHUNK_ERROR_KEY) || "0", 10);
      if (count >= 2) {
        sessionStorage.removeItem(CHUNK_ERROR_KEY);
        this.setState({ hasError: true });
        return;
      }
      sessionStorage.setItem(CHUNK_ERROR_KEY, String(count + 1));
      const cacheBust = "_cb=" + Date.now();
      const hasCacheBust = window.location.search.includes("_cb=");
      if (hasCacheBust) {
        window.location.href = window.location.pathname + "?" + cacheBust;
      } else {
        window.location.replace(window.location.pathname + (window.location.search ? "&" : "?") + cacheBust);
      }
      return;
    }

    this.setState({ hasError: true });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="text-center max-w-xs">
            <p className="text-muted-foreground text-sm mb-4">Something went wrong</p>
            <button
              onClick={() => window.location.href = window.location.pathname + "?_cb=" + Date.now()}
              className="text-primary text-sm underline hover:no-underline"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
