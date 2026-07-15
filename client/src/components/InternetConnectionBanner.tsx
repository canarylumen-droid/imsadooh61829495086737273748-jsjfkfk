import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, Wifi, RefreshCw, AlertTriangle, ServerCrash } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type ConnectionState = "online" | "offline" | "server_down" | "reconnecting" | "degraded";

export function InternetConnectionBanner() {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [serverReachable, setServerReachable] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>("online");
  const [showReconnected, setShowReconnected] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkServer = useCallback(async () => {
    const start = performance.now();
    try {
      const res = await fetch("/api/health", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      const ms = Math.round(performance.now() - start);
      setLatency(ms);
      const wasDown = !serverReachable;
      setServerReachable(true);
      if (wasDown) {
        setShowReconnected(true);
        queryClient.invalidateQueries();
        setTimeout(() => setShowReconnected(false), 3000);
      }
    } catch {
      setLatency(null);
      setServerReachable(false);
    }
  }, [serverReachable, queryClient]);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    checkServer();
    intervalRef.current = setInterval(checkServer, 15000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkServer]);

  useEffect(() => {
    if (!browserOnline) {
      setConnectionState("offline");
    } else if (!serverReachable) {
      setConnectionState("server_down");
    } else if (latency !== null && latency > 3000) {
      setConnectionState("degraded");
    } else if (showReconnected) {
      setConnectionState("reconnecting");
    } else {
      setConnectionState("online");
    }
  }, [browserOnline, serverReachable, showReconnected, latency]);

  return (
    <AnimatePresence>
      {connectionState === "offline" && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="fixed top-0 left-0 right-0 z-[9999] bg-amber-600/95 backdrop-blur-md text-white shadow-lg"
        >
          <div className="flex items-center justify-center gap-3 py-2.5 px-4">
            <WifiOff className="h-4 w-4 animate-pulse" />
            <p className="text-sm font-semibold">
              You're offline — data may not be up to date
            </p>
            <button
              onClick={() => { queryClient.refetchQueries(); checkServer(); }}
              className="ml-2 flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        </motion.div>
      )}

      {connectionState === "server_down" && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="fixed top-0 left-0 right-0 z-[9999] bg-red-600/95 backdrop-blur-md text-white shadow-lg"
        >
          <div className="flex items-center justify-center gap-3 py-2.5 px-4">
            <ServerCrash className="h-4 w-4 animate-pulse" />
            <p className="text-sm font-semibold">
              Server unreachable — data may be stale
            </p>
            <button
              onClick={checkServer}
              className="ml-2 flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        </motion.div>
      )}

      {connectionState === "degraded" && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500/90 backdrop-blur-md text-white shadow-lg"
        >
          <div className="flex items-center justify-center gap-2 py-2 px-4">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm font-semibold">
              Slow connection detected ({latency}ms) — some features may be delayed
            </p>
          </div>
        </motion.div>
      )}

      {showReconnected && browserOnline && serverReachable && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="fixed top-0 left-0 right-0 z-[9999] bg-primary/95 backdrop-blur-md text-primary-foreground shadow-lg"
        >
          <div className="flex items-center justify-center gap-2 py-2.5 px-4">
            <Wifi className="h-4 w-4" />
            <p className="text-sm font-semibold">
              {connectionState === "server_down" ? "Server back online" : "Back online"} — syncing data...
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
