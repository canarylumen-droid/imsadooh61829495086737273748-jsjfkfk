import { Route, Switch, useLocation } from "wouter";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { lazy, Suspense } from "react";
import NotFound from "@/pages/not-found";
const DashboardHome = lazy(() => import("./home"));
const InboxPage = lazy(() => import("./inbox"));
const DealsPage = lazy(() => import("./deals"));
const IntegrationsPage = lazy(() => import("./integrations"));
const InsightsPage = lazy(() => import("./insights"));
const AnalyticsPage = lazy(() => import("./analytics"));
const PricingPage = lazy(() => import("./pricing"));
const SettingsPage = lazy(() => import("./settings"));
const MCPPage = lazy(() => import("./mcp-server"));
const LeadImportPage = lazy(() => import("./lead-import"));
const ObjectionsLibraryPage = lazy(() => import("./objections-library"));
const LeadProfilePage = lazy(() => import("./lead-profile"));
const LeadRecoveryPage = lazy(() => import("./lead-recovery"));
const WarmupPage = lazy(() => import("./warmup"));
const DeliverabilityPage = lazy(() => import("./deliverability"));
const DeveloperPage = lazy(() => import("./developer"));

export default function DashboardRoutes() {
  const [location] = useLocation();
  const isFullHeightPage = location.includes('/dashboard/inbox') || location.includes('/dashboard/leads/');

  return (
    <DashboardLayout fullHeight={isFullHeightPage}>
      <Suspense fallback={<div className="flex items-center justify-center p-8">Loading...</div>}>
        <Switch>
          <Route path="/dashboard" component={DashboardHome} />
          <Route path="/dashboard/inbox" component={InboxPage} />
          <Route path="/dashboard/inbox/:id" component={InboxPage} />
          <Route path="/dashboard/leads/:id" component={LeadProfilePage} />
          <Route path="/dashboard/deals" component={DealsPage} />
          <Route path="/dashboard/integrations" component={IntegrationsPage} />
          <Route path="/dashboard/insights" component={InsightsPage} />
          <Route path="/dashboard/analytics" component={AnalyticsPage} />
          <Route path="/dashboard/pricing" component={PricingPage} />
          <Route path="/dashboard/settings" component={SettingsPage} />
          <Route path="/dashboard/mcp-server" component={MCPPage} />
          <Route path="/dashboard/lead-import" component={LeadImportPage} />
          <Route path="/dashboard/objections" component={ObjectionsLibraryPage} />
          <Route path="/dashboard/lead-recovery" component={LeadRecoveryPage} />
          <Route path="/dashboard/warmup" component={WarmupPage} />
          <Route path="/dashboard/deliverability" component={DeliverabilityPage} />
          <Route path="/dashboard/developer" component={DeveloperPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}
