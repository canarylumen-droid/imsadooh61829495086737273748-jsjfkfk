import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface AuthGuardProps {
  children: ReactNode;
  adminOnly?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
  plan?: string;
  [key: string]: any;
}

/**
 * AuthGuard: Enforces authentication and optional role-based access
 * - Regular users: redirects to /auth if not logged in
 * - Admin users: requires role === 'admin', redirects to /auth if not admin
 */
export function AuthGuard({ children, adminOnly = false }: AuthGuardProps) {
  const [, setLocation] = useLocation();

  const { data: user, isLoading, error } = useQuery<AuthUser>({
    queryKey: ["/api/user/profile"],
    retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fast-track: check localStorage to avoid flicker for already-onboarded users
  const localOnboardingStatus = localStorage.getItem('onboarding_completed') === 'true';
  const onboardingCompleted = user?.metadata?.onboardingCompleted === true || localOnboardingStatus;

  useEffect(() => {
    if (!isLoading && !error) {
      if (!user) {
        setLocation("/auth");
        return;
      }

      // Check for onboarding completion
      const serverOnboardingCompleted = user.metadata?.onboardingCompleted === true;
      const currentPath = window.location.pathname;
      
      // Sync localStorage with server reality
      if (serverOnboardingCompleted) {
        localStorage.setItem('onboarding_completed', 'true');
      }

      // If user is logged in, but hits "/" redirect immediately to /dashboard
      if (currentPath === "/") {
        setLocation("/dashboard");
        return;
      }

      if (!serverOnboardingCompleted && 
          currentPath !== "/onboarding" && 
          !currentPath.startsWith("/auth") &&
          currentPath !== "/login" &&
          currentPath !== "/signup" &&
          user.role !== "admin") {
        localStorage.removeItem('onboarding_completed');
        setLocation("/onboarding");
        return;
      }

      if (adminOnly && user.role !== "admin") {
        console.warn(`⛔ User is not admin (role: ${user.role}), redirecting to /auth`);
        setLocation("/auth");
      }
    }
  }, [user, isLoading, error, adminOnly, setLocation]);

  // Show loading while checking auth
  // IF we have a local flag that onboarding is done, don't show the full page loader 
  // unless there's an actual error or we ABSOLUTELY need to block.
  if (isLoading && !localOnboardingStatus) {
    return (
      <Dialog open={true} onOpenChange={() => { }}>
        <DialogContent className="sm:max-w-md border-0 bg-background/80 backdrop-blur-md">
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <div className="relative w-12 h-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary relative z-10" />
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-white/70 font-medium tracking-tight">Accessing Secure Environment...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // If authenticated (and admin check passed if required), show content
  if (user && (!adminOnly || user.role === "admin")) {
    return <>{children}</>;
  }

  // Fallback
  return null;
}
