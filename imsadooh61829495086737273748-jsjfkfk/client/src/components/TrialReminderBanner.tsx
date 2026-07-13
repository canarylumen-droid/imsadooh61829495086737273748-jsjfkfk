import { motion, AnimatePresence } from "framer-motion";
import { Clock, AlertCircle, X } from "lucide-react";
import { Button } from "./ui/button";
import { useLocation } from "wouter";
import { useState } from "react";

interface TrialReminderBannerProps {
  daysLeft: number;
  plan: string;
}

export function TrialReminderBanner({ daysLeft, plan }: TrialReminderBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [, setLocation] = useLocation();
  
  if (plan !== "trial" || daysLeft > 3 || daysLeft < 0 || dismissed) {
    return null;
  }

  const isUrgent = daysLeft <= 1;
  const displayText = daysLeft === 0 
    ? "Your free trial ends today" 
    : `Your free trial is ending in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`w-full ${isUrgent ? 'bg-gradient-to-r from-red-500/20 to-orange-500/20 border-red-500/50' : 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/50'} border-b backdrop-blur-sm z-40 sticky top-0`}
      >
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1">
              {isUrgent ? (
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 animate-pulse" />
              ) : (
                <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">
                  {displayText}.
                </span>
                <span className="text-white/90">
                  Upgrade to keep closing deals.
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setLocation('/dashboard/pricing')}
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-bold shadow-lg flex-shrink-0"
              >
                Upgrade Now
              </Button>
              <button
                onClick={() => setDismissed(true)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4 text-white/70" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
