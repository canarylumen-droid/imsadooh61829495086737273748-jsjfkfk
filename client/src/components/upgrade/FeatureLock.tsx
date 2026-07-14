import { Lock, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { isPaidPlan, getActivePlanId } from "@shared/plan-utils";

interface FeatureLockProps {
  featureName: string;
  description: string;
  requiredPlan?: string;
  children?: React.ReactNode;
  className?: string;
  variant?: "overlay" | "inline" | "card";
  comingSoonFeature?: boolean;
}

interface UserData {
  user?: {
    subscriptionTier?: string;
  };
}

export function FeatureLock({
  featureName,
  description,
  requiredPlan = "Starter",
  children,
  className,
  variant = "overlay",
  comingSoonFeature = false
}: FeatureLockProps) {
  const [, setLocation] = useLocation();
  const { data: userData } = useQuery<UserData>({ queryKey: ["/api/user"] });
  const isPaid = isPaidPlan(getActivePlanId(userData?.user));

  const handleUpgrade = () => {
    setLocation("/dashboard/pricing");
  };

  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border border-border", className)}>
        <Lock className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground flex-1">{featureName} - {requiredPlan} plan required</span>
        <Button size="sm" variant="default" onClick={handleUpgrade} className="text-xs">
          Upgrade
        </Button>
      </div>
    );
  }

  if (variant === "card") {
    const isComingSoon = comingSoonFeature && isPaid;
    
    return (
      <Card className={cn("relative overflow-hidden", className)}>
        <div className="absolute inset-0 bg-gradient-to-br from-background/95 to-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
          <div className="text-center space-y-4 p-6">
            <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center ${
              isComingSoon ? "bg-blue-500/10" : "bg-primary/10"
            }`}>
              {isComingSoon ? (
                <Zap className={`w-6 h-6 ${isComingSoon ? "text-blue-500" : "text-primary"}`} />
              ) : (
                <Lock className="w-6 h-6 text-primary" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-lg mb-1">
                {isComingSoon ? "⏳ Coming Soon" : `🔒 ${featureName}`}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {isComingSoon 
                  ? `${featureName} will be available soon. We're working on it!`
                  : description
                }
              </p>
              {!isComingSoon && (
                <Button onClick={handleUpgrade} className="gap-2">
                  <Sparkles className="w-4 h-4" />
                  Upgrade to {requiredPlan}
                </Button>
              )}
            </div>
          </div>
        </div>
        {children}
      </Card>
    );
  }

  // Default: overlay variant
  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-0 bg-background/90 backdrop-blur-sm z-50 flex items-center justify-center rounded-lg">
        <Card className="max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <CardTitle>🔒 {featureName}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              Available on <span className="font-semibold text-foreground">{requiredPlan}</span> plan and above
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={handleUpgrade} className="w-full gap-2">
              <Sparkles className="w-4 h-4" />
              Upgrade to Unlock
            </Button>
          </CardFooter>
        </Card>
      </div>
      <div className="pointer-events-none blur-sm opacity-50">
        {children}
      </div>
    </div>
  );
}
