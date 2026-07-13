import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  MessageSquare, 
  Target,
  Activity,
  ArrowLeft,
  Zap,
  Clock,
  BarChart3,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Brain,
  Building2,
  User,
  ArrowRight
} from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { useQuery } from "@tanstack/react-query";

interface OverviewData {
  totalUsers: number;
  activeUsers: number;
  newUsers: number;
  mrr: number;
  totalLeads: number;
  totalMessages: number;
}

interface PreviousPeriodData {
  totalUsers: number;
  activeUsers: number;
  mrr: number;
  totalLeads: number;
  totalMessages: number;
  period: string;
}

interface MetricsData {
  metrics: {
    totalUsers: number;
    activeUsers: number;
    trialUsers: number;
    paidUsers: number;
    mrr: number;
    apiBurn: number;
    failedJobs: number;
    storageUsed: number;
  };
  recentUsers: Array<{
    id: string;
    name: string | null;
    email: string;
    plan: string | null;
    createdAt: string;
  }>;
}

interface OnboardingStats {
  total: number;
  roles: Array<{ userRole: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
  businessSizes: Array<{ businessSize: string; count: number }>;
}

// Helper function to calculate percentage change
function calculatePercentageChange(current: number, previous: number | undefined): string {
  if (previous === undefined || previous === 0) {
    return current > 0 ? "+100%" : "0%";
  }
  const change = ((current - previous) / previous) * 100;
  if (isNaN(change)) return "0%";
  return change > 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();

  const { data: overview, isLoading } = useQuery<OverviewData>({
    queryKey: ["/api/admin/overview"],

  });

  const { data: metrics } = useQuery<MetricsData>({
    queryKey: ["/api/admin/metrics"],

  });

  // Fetch previous period data for real-time percentages
  const { data: previousPeriod } = useQuery<PreviousPeriodData>({
    queryKey: ["/api/admin/overview/previous"],

  });

  const { data: onboarding } = useQuery<OnboardingStats>({
    queryKey: ["/api/admin/analytics/onboarding"],

  });

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </AdminLayout>
    );
  }

  const stats = [
    {
      title: "Total Users",
      value: overview?.totalUsers || 0,
      icon: Users,
      change: `+${overview?.newUsers || 0} this month`,
      trend: "up",
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-100 dark:bg-blue-900/20",
      percentageChange: calculatePercentageChange(overview?.totalUsers || 0, previousPeriod?.totalUsers),
    },
    {
      title: "Active Users",
      value: overview?.activeUsers || 0,
      icon: Activity,
      change: "Last 30 days",
      trend: "neutral",
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-100 dark:bg-green-900/20",
      percentageChange: calculatePercentageChange(overview?.activeUsers || 0, previousPeriod?.activeUsers),
    },
    {
      title: "Monthly Revenue (MRR)",
      value: `$${overview?.mrr || 0}`,
      icon: DollarSign,
      change: "All active subscriptions",
      trend: "up",
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-100 dark:bg-emerald-900/20",
      percentageChange: calculatePercentageChange(overview?.mrr || 0, previousPeriod?.mrr),
    },
    {
      title: "Total Leads",
      value: overview?.totalLeads || 0,
      icon: Target,
      change: "All users",
      trend: "neutral",
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-100 dark:bg-purple-900/20",
      percentageChange: calculatePercentageChange(overview?.totalLeads || 0, previousPeriod?.totalLeads),
    },
    {
      title: "Total Messages",
      value: overview?.totalMessages || 0,
      icon: MessageSquare,
      change: "All conversations",
      trend: "neutral",
      color: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-100 dark:bg-orange-900/20",
      percentageChange: calculatePercentageChange(overview?.totalMessages || 0, previousPeriod?.totalMessages),
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
                Audnix Admin Dashboard
              </h1>
              <Badge variant="outline" className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-emerald-500/30">
                Admin Dashboard
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              Monitor and manage your audnixai.com platform
            </p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to User Dashboard
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <Card key={stat.title} className="hover:shadow-lg transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <div className={`${stat.bgColor} p-2 rounded-lg`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {stat.change} 
                  <span className={`font-semibold ${stat.percentageChange.startsWith('+') ? 'text-green-500' : stat.percentageChange.startsWith('-') ? 'text-red-500' : 'text-gray-500'}`}>
                    {stat.percentageChange}
                  </span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => setLocation("/admin/users")}
              >
                <Users className="w-4 h-4 mr-2" />
                Manage Users
              </Button>
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => setLocation("/admin/analytics")}
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                View Analytics
              </Button>
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => setLocation("/admin/leads")}
              >
                <Target className="w-4 h-4 mr-2" />
                Browse All Leads
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Database</span>
                <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  Online
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">API Server</span>
                <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  Healthy
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Background Workers</span>
                <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  Running
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Onboarding Analytics */}
        {onboarding && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">User Onboarding Insights</h2>
            {onboarding.total > 0 ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Users by Role</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {onboarding.roles.map((role) => (
                        <div key={role.userRole} className="flex items-center justify-between">
                          <span className="text-sm capitalize">{role.userRole || 'Unknown'}</span>
                          <Badge variant="secondary">{role.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Traffic Sources</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {onboarding.sources.slice(0, 6).map((source) => (
                        <div key={source.source} className="flex items-center justify-between">
                          <span className="text-sm">{source.source || 'Unknown'}</span>
                          <Badge variant="secondary">{source.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Business Size</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {onboarding.businessSizes.map((size) => (
                        <div key={size.businessSize} className="flex items-center justify-between">
                          <span className="text-sm capitalize">{size.businessSize?.replace('_', ' ') || 'Unknown'}</span>
                          <Badge variant="secondary">{size.count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p>No onboarding data yet. Data will appear once users complete onboarding.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
