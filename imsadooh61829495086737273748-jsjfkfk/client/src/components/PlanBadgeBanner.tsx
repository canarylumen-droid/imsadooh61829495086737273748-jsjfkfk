import { motion } from "framer-motion";
import { Crown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PlanBadgeBannerProps {
  plan: string;
}

export function PlanBadgeBanner({ plan }: PlanBadgeBannerProps) {
  if (!plan || plan === "trial") {
    return null;
  }

  const getPlanConfig = (planType: string) => {
    switch (planType.toLowerCase()) {
      case "starter":
        return {
          label: "Starter Plan",
          icon: Sparkles,
          gradient: "from-blue-500 to-cyan-500",
          bgGradient: "from-blue-500/10 to-cyan-500/10",
        };
      case "pro":
        return {
          label: "Pro Plan",
          icon: Crown,
          gradient: "from-purple-500 to-cyan-500",
          bgGradient: "from-purple-500/10 to-cyan-500/10",
        };
      case "enterprise":
        return {
          label: "Enterprise Plan",
          icon: Crown,
          gradient: "from-amber-500 to-orange-500",
          bgGradient: "from-amber-500/10 to-orange-500/10",
        };
      default:
        return null;
    }
  };

  const config = getPlanConfig(plan);

  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gradient-to-r ${config.bgGradient} border-b border-${plan === 'enterprise' ? 'amber' : plan === 'pro' ? 'purple' : 'blue'}-500/20 px-4 py-2`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        <Badge
          className={`bg-gradient-to-r ${config.gradient} text-white border-0 px-3 py-1 flex items-center gap-1.5`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="font-semibold text-sm">{config.label}</span>
        </Badge>
        <span className="text-xs text-muted-foreground">
          All premium features unlocked
        </span>
      </div>
    </motion.div>
  );
}
