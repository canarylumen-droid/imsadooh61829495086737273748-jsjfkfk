import { Route, Switch, useLocation } from "wouter";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { lazy, Suspense } from "react";
const DashboardHome = lazy(() => import("./home"));
const InboxPage = lazy(() => import("./inbox"));
const DealsPage = lazy(() => import("./deals"));
const CalendarPage = lazy(() => import("./calendar"));
const IntegrationsPage = lazy(() => import("./integrations"));
const InsightsPage = lazy(() => import("./insights"));
const AnalyticsPage = lazy(() => import("./analytics"));

// Lazy load pages that might be large or are duplicated in App.tsx
const PricingPage = lazy(() => import("./pricing"));
const SettingsPage = lazy(() => import("./settings"));
const LeadImportPage = lazy(() => import("./lead-import"));
const VideoAutomationPage = lazy(() => import("./video-automation"));
const CloserEngineLive = lazy(() => import("./closer-engine"));
const SalesAssistant = lazy(() => import("./sales-assistant"));
const ContentLibraryPage = lazy(() => import("./content-library"));
const AIDecisionsPage = lazy(() => import("./ai-decisions"));
const ObjectionsLibraryPage = lazy(() => import("./objections-library"));
const CustomKnowledgePage = lazy(() => import("./custom-knowledge"));
const SandboxPage = lazy(() => import("./sandbox"));
const ProspectingPage = lazy(() => import("./prospecting"));
const LeadProfilePage = lazy(() => import("./lead-profile"));
const PendingPaymentsPage = lazy(() => import("./pending-payments"));

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
          {/* ... other routes ... */}
          <Route path="/dashboard/deals" component={DealsPage} />
          <Route path="/dashboard/calendar" component={CalendarPage} />
          <Route path="/dashboard/integrations" component={IntegrationsPage} />
          <Route path="/dashboard/insights" component={InsightsPage} />
          <Route path="/dashboard/analytics" component={AnalyticsPage} />
          <Route path="/dashboard/pricing" component={PricingPage} />
          <Route path="/dashboard/settings" component={SettingsPage} />
          <Route path="/dashboard/lead-import" component={LeadImportPage} />
          <Route path="/dashboard/video-automation" component={VideoAutomationPage} />
          <Route path="/dashboard/closer-engine" component={CloserEngineLive} />
          <Route path="/dashboard/sales-assistant" component={SalesAssistant} />
          <Route path="/dashboard/content-library" component={ContentLibraryPage} />
          <Route path="/dashboard/ai-decisions" component={AIDecisionsPage} />
          <Route path="/dashboard/objections" component={ObjectionsLibraryPage} />
          <Route path="/dashboard/custom-knowledge" component={CustomKnowledgePage} />
          <Route path="/dashboard/sandbox" component={SandboxPage} />
          <Route path="/dashboard/prospecting" component={ProspectingPage} />
          <Route path="/dashboard/pending-payments" component={PendingPaymentsPage} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}
