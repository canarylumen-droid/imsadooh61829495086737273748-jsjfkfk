/**
 * Already Joined Banner - Shows patience animation for users who've joined early access
 * Makes them feel welcome, not rejected, while they wait for feature
 */

import { motion } from 'framer-motion';
import { CheckCircle2, Sparkles as SparklesIcon, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface AlreadyJoinedBannerProps {
  featureName: string;
  eta?: string;
}

export function AlreadyJoinedBanner({ featureName, eta = "Q1 2026" }: AlreadyJoinedBannerProps) {
  // Patience animation - dots cycling
  const dotVariants = {
    animate: {
      opacity: [1, 0.4, 1],
      transition: { duration: 1.5, repeat: Infinity }
    }
  };

  const pulseVariants = {
    animate: {
      scale: [1, 1.05, 1],
      opacity: [1, 0.8, 1],
      transition: { duration: 2, repeat: Infinity }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 to-emerald-600/5 overflow-hidden">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            {/* Animated checkmark */}
            <motion.div
              className="flex-shrink-0"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <div className="p-3 rounded-full bg-emerald-500/20">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
            </motion.div>

            {/* Main message */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-foreground">You're all set!</h3>
                <SparklesIcon className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-sm text-muted-foreground">
                You've joined early access for <span className="font-medium text-foreground">{featureName}</span>. 
                We're getting everything ready for you.
              </p>
            </div>

            {/* Patience indicator - animated dots */}
            <div className="flex-shrink-0 flex items-center gap-1">
              <motion.span variants={dotVariants} animate="animate" className="w-2 h-2 rounded-full bg-emerald-500" />
              <motion.span
                variants={dotVariants}
                animate="animate"
                transition={{ delay: 0.2 }}
                className="w-2 h-2 rounded-full bg-emerald-500"
              />
              <motion.span
                variants={dotVariants}
                animate="animate"
                transition={{ delay: 0.4 }}
                className="w-2 h-2 rounded-full bg-emerald-500"
              />
            </div>
          </div>

          {/* Patience message - scrolling */}
          <motion.div
            className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-emerald-600 animate-spin" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                We're crafting something special. Expected: <span className="font-semibold">{eta}</span>
              </p>
            </div>
          </motion.div>

          {/* Timeline message */}
          <p className="mt-3 text-xs text-muted-foreground text-center">
            ✓ You'll be notified as soon as {featureName} launches • No action needed right now
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
