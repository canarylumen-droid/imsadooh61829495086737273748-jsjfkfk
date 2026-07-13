import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function InternetConnectionBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      // Auto-refresh all data on reconnect
      queryClient.invalidateQueries();
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient]);

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="fixed top-0 left-0 right-0 z-[9999] bg-red-500/95 backdrop-blur-md text-white shadow-lg"
        >
          <div className="flex items-center justify-center gap-3 py-2.5 px-4">
            <WifiOff className="h-4 w-4 animate-pulse" />
            <p className="text-sm font-semibold">
              You're offline — data may not be up to date
            </p>
            <button
              onClick={() => queryClient.refetchQueries()}
              className="ml-2 flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        </motion.div>
      )}

      {showReconnected && isOnline && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="fixed top-0 left-0 right-0 z-[9999] bg-emerald-500/95 backdrop-blur-md text-white shadow-lg"
        >
          <div className="flex items-center justify-center gap-2 py-2.5 px-4">
            <Wifi className="h-4 w-4" />
            <p className="text-sm font-semibold">
              Back online — syncing data...
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
