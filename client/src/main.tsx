import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0,
    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.MODE,
  });
}

// Handle Vite chunk load errors gracefully
window.addEventListener('error', (e) => {
  if (e.message.includes('Failed to fetch dynamically imported module') ||
   (e.error && e.error.name === 'ChunkLoadError') || (e.message && e.message.includes('Loading chunk'))) {
    console.warn('Chunk load error detected. Please refresh the page if the app is unresponsive.', e);
    // window.location.reload(); // Removed to prevent forced refreshes
  }
}, true);

createRoot(document.getElementById("root")!).render(
  <>
    <App />
  </>
);
