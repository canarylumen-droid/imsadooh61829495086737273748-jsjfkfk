import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users,
  DollarSign,
  Zap,
  AlertCircle,
  TrendingUp,
  Activity,
  Loader2,
  Shield,
  Search,
  Gift,
  XCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function AdminPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [foundUser, setFoundUser] = useState<any>(null);
  const [searchError, setSearchError] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch real admin metrics from backend
  const { data: metricsData, isLoading, error } = useQuery<any>({
    queryKey: ["/api/admin/metrics"],
    retry: false,
  });

  // Search for user by email or username
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchError("Please enter an email or username");
      return;
    }

    setIsSearching(true);
    setFoundUser(null);
    setSearchError("");

    try {
      const response = await fetch(`/api/admin/users?search=${encodeURIComponent(searchQuery.trim())}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const data = await response.json();

      if (data.users && data.users.length > 0) {
        setFoundUser(data.users[0]);
        setSelectedPlan(data.users[0].plan || "free");
      } else {
        setSearchError("No user found with that email or username. Please check the spelling and try again.");
      }
    } catch (err) {
      setSearchError("An error occurred while searching. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  // Award plan mutation
  const awardPlanMutation = useMutation({
    mutationFn: async ({ userId, plan }: { userId: string; plan: string }) => {
      const response = await fetch(`/api/admin/users/${userId}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to award plan");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Plan Awarded Successfully",
        description: `${foundUser.email} has been upgraded to ${selectedPlan.toUpperCase()} plan`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/metrics"] });
      setFoundUser({ ...foundUser, plan: selectedPlan });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Award Plan",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const metrics = metricsData?.metrics || {
    totalUsers: 0,
    activeUsers: 0,
    trialUsers: 0,
    paidUsers: 0,
    mrr: 0,
    apiBurn: 0,
    failedJobs: 0,
    storageUsed: 0,
  };

  const recentUsers = metricsData?.recentUsers || [];

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const getPlanBadgeVariant = (plan: string) => {
    switch (plan?.toLowerCase()) {
      case 'enterprise':
        return 'default';
      case 'pro':
        return 'secondary';
      case 'starter':
        return 'outline';
      default:
        return 'outline';
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 lg:p-8">
        <div className="text-center py-12">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You don't have permission to view admin metrics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-10 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight" data-testid="heading-admin">
            Admin Console
          </h1>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mt-1">
            System Diagnostics & Governance Control
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-semibold uppercase tracking-wider">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          System Link Stable
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card data-testid="card-metric-total-users" className="border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden group hover:scale-[1.02] transition-transform duration-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Network Population
              </CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-3xl font-bold text-white tracking-tight" data-testid="text-total-users">
                {metrics.totalUsers.toLocaleString()}
              </div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-primary/60 mt-2">
                Total Identity Logs
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
        >
          <Card data-testid="card-metric-active-users" className="border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden group hover:scale-[1.02] transition-transform duration-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Active Users
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-3xl font-bold text-white tracking-tight" data-testid="text-active-users">
                {metrics.activeUsers.toLocaleString()}
              </div>
              {metrics.totalUsers > 0 ? (
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mt-2">
                  {Math.round((metrics.activeUsers / metrics.totalUsers) * 100)}% of total
                </p>
              ) : (
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mt-2">
                  0% of total
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <Card data-testid="card-metric-mrr" className="border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden group hover:scale-[1.02] transition-transform duration-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Projected Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-3xl font-bold text-white tracking-tight" data-testid="text-mrr">
                ${metrics.mrr.toLocaleString()}
              </div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500/60 mt-2">
                <TrendingUp className="h-3 w-3 inline mr-1" />
                Growth Velocity Active
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Card data-testid="card-metric-api-burn" className="border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden group hover:scale-[1.02] transition-transform duration-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                API Consumption
              </CardTitle>
              <Zap className="h-4 w-4 text-orange-500 fill-orange-500/20" />
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-3xl font-bold text-white tracking-tight" data-testid="text-api-burn">
                ${metrics.apiBurn.toLocaleString()}
              </div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-orange-500/60 mt-2">
                Resource Utilization Rate
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* User Search & Plan Awarding */}
      <Card data-testid="card-award-plan" className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="h-5 w-5 text-primary" />
            Award Plan to User
          </CardTitle>
          <CardDescription>
            Search for a user by email or username, then select a plan to grant them full access without payment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Input */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative group">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/20 group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="Search digital identity (email or username)..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="w-full pl-12 h-11 bg-black/40 border-white/5 rounded-xl focus:border-primary/50 text-white font-semibold transition-all text-sm"
              />
            </div>
            <Button
              onClick={handleSearch}
              disabled={isSearching}
              className="px-6 h-11 rounded-xl bg-white text-black font-bold uppercase tracking-wider text-[10px] hover:scale-105 transition-all"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Locate User"
              )}
            </Button>
          </div>

          {/* Search Error */}
          {searchError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
            >
              <XCircle className="h-4 w-4 flex-shrink-0" />
              <p className="text-sm">{searchError}</p>
            </motion.div>
          )}

          {/* Found User Card */}
          {foundUser && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-muted/50 border border-border/40 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="font-semibold text-primary">
                      {foundUser.email?.charAt(0).toUpperCase() || "U"}
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold">{foundUser.name || foundUser.username || "No name"}</p>
                    <p className="text-sm text-muted-foreground">{foundUser.email}</p>
                  </div>
                </div>
                <Badge variant={foundUser.plan === 'enterprise' ? 'default' : foundUser.plan === 'pro' ? 'secondary' : 'outline'}>
                  Current: {foundUser.plan || 'free'}
                </Badge>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-6 pt-4">
                <div className="w-full sm:flex-1 space-y-3">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-white/40 ml-1">Entitlement Selection</Label>
                  <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                    <SelectTrigger className="h-11 bg-black/40 border-white/5 rounded-xl font-semibold uppercase tracking-wider text-[10px]">
                      <SelectValue placeholder="Select high-tier plan" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-white/10 text-white">
                      <SelectItem value="free" className="font-bold">FREE (RESTRICTED)</SelectItem>
                      <SelectItem value="trial" className="font-bold">TRIAL (ELITE ACCESS)</SelectItem>
                      <SelectItem value="starter" className="font-bold text-primary">STARTER TIER</SelectItem>
                      <SelectItem value="pro" className="font-bold text-purple-400">PRO COMMANDER</SelectItem>
                      <SelectItem value="enterprise" className="font-bold text-orange-400">ENTERPRISE ARCHITECT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => awardPlanMutation.mutate({ userId: foundUser.id, plan: selectedPlan })}
                  disabled={awardPlanMutation.isPending || selectedPlan === foundUser.plan}
                  className="w-full sm:w-auto h-11 px-6 rounded-xl bg-gradient-to-r from-primary to-purple-600 text-white font-bold uppercase tracking-wider text-[10px] hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/15"
                >
                  {awardPlanMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Authorize Plan Grant"
                  )}
                </Button>
              </div>

              {selectedPlan !== foundUser.plan && (
                <p className="text-xs text-muted-foreground">
                  This will grant {foundUser.email} full access to the <strong>{selectedPlan.toUpperCase()}</strong> plan without requiring payment.
                </p>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* User Breakdown */}
        <Card data-testid="card-user-breakdown" className="rounded-2xl border-border/40 bg-card/40 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-base font-bold">User Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Trial</Badge>
                <span className="text-sm text-muted-foreground font-medium">Trial Users</span>
              </div>
              <span className="font-semibold text-white">{metrics.trialUsers}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Paid</Badge>
                <span className="text-sm text-muted-foreground font-medium">Paid Users</span>
              </div>
              <span className="font-semibold text-white">{metrics.paidUsers}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default">Active</Badge>
                <span className="text-sm text-muted-foreground font-medium">Active Today</span>
              </div>
              <span className="font-semibold text-white">{metrics.activeUsers}</span>
            </div>
          </CardContent>
        </Card>

        {/* System Health */}
        <Card data-testid="card-system-health" className="rounded-2xl border-border/40 bg-card/40 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-base font-bold">System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-medium">Failed Jobs</span>
              <div className="flex items-center gap-2">
                {metrics.failedJobs > 0 ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="font-semibold text-destructive">
                      {metrics.failedJobs}
                    </span>
                  </>
                ) : (
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/20">
                    All Good
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-medium">Storage Used</span>
              <span className="font-semibold text-white">{metrics.storageUsed} GB</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground font-medium">System Status</span>
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/20">
                Operational
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Users */}
      <Card data-testid="card-recent-users" className="rounded-2xl border-border/40 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-base font-bold">Recent Sign-ups</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {recentUsers.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground font-medium">No recent sign-ups</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentUsers.map((user: any, index: number) => (
                <motion.div
                  key={user.email}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  data-testid={`recent-user-${index}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-semibold">
                        {user.email?.charAt(0).toUpperCase() || "U"}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-white" data-testid={`text-user-email-${index}`}>
                        {user.email}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium">
                        {formatTimeAgo(user.signedUp)}
                      </p>
                    </div>
                  </div>
                  <Badge variant={getPlanBadgeVariant(user.plan)} data-testid={`badge-plan-${index}`}>
                    {user.plan || "Trial"}
                  </Badge>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
