import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles, X } from "lucide-react";
import { useLocation } from "wouter";

const UPGRADE_DISMISSED_KEY = 'audnixUpgradeDismissedAt';
const DISMISS_DURATION_DAYS = 30;

export type UpgradeVariant = 'trialExpired' | 'trialReminder' | 'planLimit' | 'featureLocked';

interface UpgradePromptProps {
  variant: UpgradeVariant;
  daysLeft?: number;
  limitType?: 'leads' | 'voiceMinutes';
  onClose?: () => void;
  isBlocking?: boolean;
}

const contentMap: Record<UpgradeVariant, {
  title: string;
  description: string;
  benefits: string[];
  cta: string;
  microcopy?: string;
}> = {
  trialExpired: {
    title: "You've hit your limit.",
    description: "Upgrade to keep booking meetings + converting warm leads.",
    benefits: [
      "Stop letting warm leads go cold",
      "Book more meetings → upgrade",
      "Your leads won't wait"
    ],
    cta: "Upgrade",
    microcopy: "View-only mode enabled. Upgrade to resume actions."
  },
  trialReminder: {
    title: "Your free trial is ending soon",
    description: "Upgrade to keep closing deals.",
    benefits: [
      "Keep your momentum going",
      "Don't lose access to your pipeline",
      "Lock in your current progress"
    ],
    cta: "Upgrade Now"
  },
  planLimit: {
    title: "Limit reached.",
    description: "Upgrade to keep messaging + booking meetings.",
    benefits: [
      "Continue your conversations",
      "Don't lose active leads",
      "Scale your outreach"
    ],
    cta: "Upgrade",
    microcopy: "View-only mode enabled. Upgrade to resume actions."
  },
  featureLocked: {
    title: "Upgrade for more",
    description: "This feature includes advanced capabilities on paid plans.",
    benefits: [
      "Unlock advanced features",
      "Boost your conversion rate",
      "Close more deals"
    ],
    cta: "View Plans"
  }
};

export function UpgradePrompt({
  variant,
  daysLeft,
  limitType,
  onClose,
  isBlocking = false
}: UpgradePromptProps) {
  const content = contentMap[variant];
  const [, setLocation] = useLocation();
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const dismissedAt = localStorage.getItem(UPGRADE_DISMISSED_KEY);
    if (dismissedAt) {
      const daysSinceDismissal = (Date.now() - parseInt(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissal < DISMISS_DURATION_DAYS) {
        setIsDismissed(true);
      } else {
        localStorage.removeItem(UPGRADE_DISMISSED_KEY);
      }
    }
  }, []);

  const handleUpgrade = () => {
    setLocation('/dashboard/pricing');
    onClose?.();
  };

  const handleDismiss = () => {
    localStorage.setItem(UPGRADE_DISMISSED_KEY, Date.now().toString());
    setIsDismissed(true);
    onClose?.();
  };

  const showDaysLeft = variant === 'trialReminder' && daysLeft !== undefined;
  const showLimitType = variant === 'planLimit' && limitType;

  if (isDismissed && !isBlocking) {
    return null;
  }

  return (
    <>
      {isBlocking && (
        <motion.div
          className="fixed inset-0 backdrop-blur-md bg-black/50 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
      )}

      <motion.div
        className={`${isBlocking ? 'fixed' : 'relative'} ${isBlocking ? 'inset-0 flex items-center justify-center z-50' : ''}`}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className={`${isBlocking ? 'w-full max-w-md mx-4' : 'w-full'} border-2 border-primary shadow-2xl bg-gradient-to-b from-background to-background/95`}>
          <CardHeader className="text-center space-y-4 relative">
            {onClose && !isBlocking && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <motion.div
              className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center"
              animate={isBlocking ? {
                scale: [1, 1.1, 1],
              } : {}}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <Lock className="w-8 h-8 text-primary" />
            </motion.div>

            <CardTitle className="text-2xl font-bold">
              {content.title}
              {showDaysLeft && ` (${daysLeft}d left)`}
            </CardTitle>

            <CardDescription className="text-base">
              {content.description}
              {showLimitType && ` (${limitType === 'leads' ? 'Lead' : 'Voice minutes'} limit)`}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              {content.benefits.map((benefit, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-foreground/90">{benefit}</span>
                </div>
              ))}
            </div>

            {content.microcopy && (
              <p className="text-xs text-muted-foreground border-l-2 border-primary/50 pl-3 py-2">
                {content.microcopy}
              </p>
            )}
          </CardContent>

          <CardFooter className="flex gap-2">
            <Button
              onClick={handleUpgrade}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-bold"
            >
              {content.cta}
            </Button>
            {onClose && (
              <Button
                variant="outline"
                onClick={handleDismiss}
                className="flex-1"
              >
                {isBlocking ? 'View Only' : 'Close'}
              </Button>
            )}
          </CardFooter>
        </Card>
      </motion.div>
    </>
  );
}
