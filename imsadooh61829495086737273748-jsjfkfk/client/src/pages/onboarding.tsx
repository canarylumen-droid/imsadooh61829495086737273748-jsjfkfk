import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

interface UserProfile {
  id: string;
  email: string;
  metadata?: {
    onboardingCompleted?: boolean;
  };
}

export function OnboardingPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(true);

  const { data: user, isLoading, error } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    retry: false,
  });

  useEffect(() => {
    if (!isLoading) {
      if (error || !user) {
        setLocation("/auth");
        return;
      }
      
      if (user.metadata?.onboardingCompleted) {
        setLocation("/dashboard");
      }
    }
  }, [user, isLoading, error, setLocation]);

  const handleComplete = () => {
    setWizardOpen(false);
    queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    setLocation("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <OnboardingWizard isOpen={wizardOpen} onComplete={handleComplete} />
      
      <div className="text-center space-y-6">
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin"></div>
          <div className="absolute inset-0 rounded-full border-2 border-primary/10"></div>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white tracking-tight">Initializing Workspace</h2>
          <p className="text-white/40 text-sm">Preparing your custom sales ecosystem...</p>
        </div>
      </div>
    </div>
  );
}

export default OnboardingPage;
