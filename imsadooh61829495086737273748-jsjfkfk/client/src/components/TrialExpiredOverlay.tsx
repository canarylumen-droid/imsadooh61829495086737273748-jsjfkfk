import { isDevMode } from "@/lib/supabase";
import { UpgradePrompt } from "@/components/upgrade/UpgradePrompt";

interface TrialExpiredOverlayProps {
  daysLeft: number;
  plan: string;
}

export function TrialExpiredOverlay({ daysLeft, plan }: TrialExpiredOverlayProps) {
  if (isDevMode()) {
    return null;
  }

  if (plan !== "trial" || daysLeft > 0) {
    return null;
  }

  return <UpgradePrompt variant="trialExpired" isBlocking={true} />;
}
