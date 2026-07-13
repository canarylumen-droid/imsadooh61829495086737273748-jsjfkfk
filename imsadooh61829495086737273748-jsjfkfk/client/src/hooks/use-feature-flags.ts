import { useState, useEffect, useCallback } from "react";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  payload?: any;
}

interface FeatureFlagsConfig {
  version: number;
  flags: Record<string, FeatureFlag>;
  updatedAt: string;
}

let globalConfig: FeatureFlagsConfig = {
  version: Date.now(),
  flags: {},
  updatedAt: new Date().toISOString()
};

const listeners = new Set<(config: FeatureFlagsConfig) => void>();

function notifyListeners() {
  for (const fn of listeners) fn(globalConfig);
}

export function updateFeatureFlagsFromServer(config: FeatureFlagsConfig) {
  globalConfig = config;
  notifyListeners();
}

export function useFeatureFlags() {
  const [config, setConfig] = useState<FeatureFlagsConfig>(globalConfig);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const handler = (c: FeatureFlagsConfig) => setConfig(c);
    listeners.add(handler);

    // Connect to SSE stream
    const eventSource = new EventSource(`/api/feature-flags/stream`, { withCredentials: true });

    eventSource.onopen = () => setConnected(true);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'feature_flags_updated' && data.config) {
          updateFeatureFlagsFromServer(data.config);
        }
      } catch {}
    };

    eventSource.onerror = () => {
      setConnected(false);
      // Reconnect is automatic with EventSource
    };

    // Fallback: poll every 30s if SSE fails
    const interval = setInterval(async () => {
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        try {
          const res = await fetch('/api/feature-flags', { credentials: 'include' });
          if (res.ok) {
            const cfg = await res.json();
            updateFeatureFlagsFromServer(cfg);
          }
        } catch {}
      }
    }, 30000);

    return () => {
      listeners.delete(handler);
      eventSource.close();
      clearInterval(interval);
    };
  }, []);

  const isEnabled = useCallback((key: string): boolean => {
    return config.flags[key]?.enabled ?? true;
  }, [config]);

  const getFlag = useCallback((key: string): FeatureFlag | undefined => {
    return config.flags[key];
  }, [config]);

  return { config, connected, isEnabled, getFlag };
}
