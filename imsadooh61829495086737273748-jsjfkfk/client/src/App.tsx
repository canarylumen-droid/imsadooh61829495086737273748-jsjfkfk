import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardRoutes from "@/pages/dashboard";
import { OnboardingPage } from "@/pages/onboarding";
import NotFound from "@/pages/not-found";
import PrivacyPolicy from "@/pages/privacy-policy";
import TermsOfService from "@/pages/terms-of-service";
import DataDeletion from "@/pages/data-deletion";
import { PrivacyModal } from "@/components/landing/PrivacyModal";
import { NotificationSound } from "@/components/shared/NotificationSound";
import { MailboxProvider } from "@/hooks/use-mailbox";

import { lazy, Suspense } from "react";

// Lazy load core pages for performance
const Landing = lazy(() => import("@/pages/landing"));
const Auth = lazy(() => import("@/pages/auth"));

// Solutions
const AgenciesPage = lazy(() => import("./pages/solutions/Agencies"));
const FoundersPage = lazy(() => import("./pages/solutions/Founders"));
const CreatorsPage = lazy(() => import("./pages/solutions/Creators"));
const ComparePage = lazy(() => import("./pages/compare"));
const PricingLandingPage = lazy(() => import("./pages/pricing"));
const LeadRecoveryLanding = lazy(() => import("./pages/lead-recovery-landing"));
const ObjectionHandlingLanding = lazy(() => import("./pages/objection-handling-landing"));
const NicheVaultPage = lazy(() => import("./pages/resources/niche-vault"));
const PlaybooksPage = lazy(() => import("./pages/resources/outreach-playbooks"));
const ApiDocsPage = lazy(() => import("./pages/resources/api-docs"));

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ComponentShowcase } from '@/pages/dashboard/component-test';
import { AuthGuard } from '@/components/auth-guard';
import { InternetConnectionBanner } from "@/components/InternetConnectionBanner";
// import { ExpertChat } from "@/components/landing/ExpertChat";

const AdminDashboard = lazy(() => import("./pages/admin"));
const AdminSecurity = lazy(() => import("./pages/dashboard/security"));
const AdminUsers = lazy(() => import("./pages/admin/users"));
const AdminAnalytics = lazy(() => import("./pages/admin/analytics"));
const AdminLeads = lazy(() => import("./pages/admin/leads"));
const AdminSettings = lazy(() => import("./pages/admin/settings"));

import { ThemeProvider } from "next-themes";

// Loading fallback component for Suspense boundaries
const LoadingFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-muted-foreground text-sm font-medium">Loading...</p>
    </div>
  </div>
);

function Router() {
  return (
    <Switch>
      <Route path="/auth">
        {() => <Suspense fallback={<LoadingFallback />}><Auth /></Suspense>}
      </Route>
      <Route path="/login">
        {() => <Suspense fallback={<LoadingFallback />}><Auth /></Suspense>}
      </Route>
      <Route path="/signup">
        {() => <Suspense fallback={<LoadingFallback />}><Auth /></Suspense>}
      </Route>
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/terms-of-service" component={TermsOfService} />
      <Route path="/data-deletion" component={DataDeletion} />
      <Route path="/compare">
        {() => <Suspense fallback={<LoadingFallback />}><ComparePage /></Suspense>}
      </Route>
      <Route path="/pricing">
        {() => <Suspense fallback={<LoadingFallback />}><PricingLandingPage /></Suspense>}
      </Route>
      <Route path="/lead-recovery">
        {() => <Suspense fallback={<LoadingFallback />}><LeadRecoveryLanding /></Suspense>}
      </Route>
      <Route path="/objection-handling">
        {() => <Suspense fallback={<LoadingFallback />}><ObjectionHandlingLanding /></Suspense>}
      </Route>
      <Route path="/resources/niche-vault">
        {() => <Suspense fallback={<LoadingFallback />}><NicheVaultPage /></Suspense>}
      </Route>
      <Route path="/resources/outreach-playbooks">
        {() => <Suspense fallback={<LoadingFallback />}><PlaybooksPage /></Suspense>}
      </Route>
      <Route path="/resources/api-docs">
        {() => <Suspense fallback={<LoadingFallback />}><ApiDocsPage /></Suspense>}
      </Route>

      {/* Solutions */}
      <Route path="/solutions/agencies">
        {() => <Suspense fallback={<LoadingFallback />}><AgenciesPage /></Suspense>}
      </Route>
      <Route path="/solutions/sales-teams">
        {() => <Suspense fallback={<LoadingFallback />}><FoundersPage /></Suspense>}
      </Route>
      <Route path="/solutions/creators">
        {() => <Suspense fallback={<LoadingFallback />}><CreatorsPage /></Suspense>}
      </Route>

      <Route path="/">
        {() => <Suspense fallback={<LoadingFallback />}><Landing /></Suspense>}
      </Route>
      <Route path="/components">
        {() => (
          <AuthGuard>
            <ComponentShowcase />
          </AuthGuard>
        )}
      </Route>
      {/* All dashboard routes handled by DashboardRoutes with layout */}
      {/* Two routes inside Switch — first matches /dashboard exactly, second matches sub-pages */}
      <Route path="/dashboard">
        {() => (
          <AuthGuard>
            <DashboardRoutes />
          </AuthGuard>
        )}
      </Route>
      <Route path="/dashboard/*">
        {() => (
          <AuthGuard>
            <DashboardRoutes />
          </AuthGuard>
        )}
      </Route>
      {/* Admin routes - uses SECRET admin URL from env variable */}
      {/* Access via: /${VITE_ADMIN_SECRET_URL} or /admin-secret-xyz (default) */}
      <Route path="/admin-secret-xyz">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminDashboard />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin-secret-xyz/users">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminUsers />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin-secret-xyz/security">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminSecurity />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin-secret-xyz/analytics">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminAnalytics />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin-secret-xyz/leads">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminLeads />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin-secret-xyz/settings">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminSettings />
          </AuthGuard>
        )}
      </Route>

      {/* Keep old /admin path for backward compatibility - redirects to secret path */}
      <Route path="/admin">
        {() => {
          const secretPath = import.meta.env.VITE_ADMIN_SECRET_URL || 'admin-secret-xyz';
          window.location.href = `/${secretPath}`;
          return null;
        }}
      </Route>
      <Route path="/admin/users">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminUsers />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin/analytics">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminAnalytics />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin/leads">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminLeads />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin/settings">
        {() => (
          <AuthGuard adminOnly={true}>
            <AdminSettings />
          </AuthGuard>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <MailboxProvider>
            <TooltipProvider>
              <InternetConnectionBanner />
              <Toaster />
              <Router />
              <NotificationSound />
              {/* <ExpertChat /> Removed as requested */}
              <PrivacyModal />
            </TooltipProvider>
          </MailboxProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
