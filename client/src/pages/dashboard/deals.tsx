
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DollarSign,
  Calendar,
  Instagram,
  Mail,
  Package,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ArrowRight,
  Filter,
  Activity,
  Plus,
  Download,
  Sparkles,
  Settings
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useMailbox } from "@/hooks/use-mailbox";
import { useRealtime } from "@/hooks/use-realtime";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { apiRequest } from "@/lib/queryClient";

interface Deal {
  id: string;
  leadId: string;
  userId: string;
  brand: string;
  channel: "instagram" | "email" | "gmail" | "manual";
  value: number;
  status: "open" | "closed_won" | "closed_lost" | "pending" | "converted";
  notes?: string | null;
  convertedAt?: string | null;
  meetingScheduled?: boolean;
  meetingUrl?: string | null;
  createdAt: string;
  leadName?: string;
}

interface DealsApiResponse {
  deals: Deal[];
}

interface TimelineDataPoint {
  date: string;
  revenue: number;
}

interface RevenueAnalyticsResponse {
  previousWeekRevenue?: number;
  previousMonthRevenue?: number;
  timeline?: TimelineDataPoint[];
}

const channelIcons: Record<string, typeof Instagram | typeof Mail> = {
  instagram: Instagram,
  email: Mail,
};

export default function DealsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const { socket } = useRealtime();

  useEffect(() => {
    if (!socket) return;
    
    let timeout: NodeJS.Timeout;
    const handleUpdate = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
        queryClient.invalidateQueries({ queryKey: ["/api/deals/analytics"] });
      }, 50);
    };

    socket.on('deals_updated', handleUpdate);
    socket.on('leads_updated', handleUpdate); // Some lead status changes affect pipeline

    return () => {
      socket.off('deals_updated', handleUpdate);
      socket.off('leads_updated', handleUpdate);
      clearTimeout(timeout);
    };
  }, [socket, queryClient]);
  const { selectedMailboxId } = useMailbox();
  const { data: dealsData, isLoading } = useQuery<DealsApiResponse>({
    queryKey: ["/api/deals", { integrationId: selectedMailboxId }],
    retry: false,
  });

  const { data: userProfile } = useQuery({
    queryKey: ["/api/user/profile"],
    retry: false,
  });

  const { data: revenueAnalytics } = useQuery<RevenueAnalyticsResponse>({
    queryKey: ["/api/deals/analytics", { integrationId: selectedMailboxId }],

    retry: false,
  });

  const deals: Deal[] = (dealsData?.deals || []).filter(d => filter === 'all' || d.status === filter);
  const totalValue = (dealsData?.deals || []).reduce((sum: number, deal: Deal) => sum + (deal.value || 0), 0);
  const convertedDeals = (dealsData?.deals || []).filter((d: Deal) => d.status === "converted" || d.status === "closed_won");
  const pendingDeals = (dealsData?.deals || []).filter((d: Deal) => d.status === "pending" || d.status === "open");

  // Calculate Avg Value
  const avgDealValue = deals.length > 0 ? Math.round(totalValue / deals.length) : 0;

  // Real-time metrics
  const today = new Date();
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);

  const weekDeals = convertedDeals.filter((d) => d.convertedAt && new Date(d.convertedAt) >= startOfWeek);
  const monthDeals = convertedDeals.filter((d) => d.convertedAt && new Date(d.convertedAt) >= startOfMonth);

  const weekRevenue = weekDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const monthRevenue = monthDeals.reduce((sum, d) => sum + (d.value || 0), 0);

  // Growth calcs
  const previousWeekRevenue = revenueAnalytics?.previousWeekRevenue || 0;
  const weekGrowth = previousWeekRevenue > 0
    ? Math.round(((weekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100)
    : weekRevenue > 0 ? 100 : 0;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const syncDeals = async () => {
    try {
      const res = await apiRequest('POST', '/api/deals/sync');
      const data = await res.json();
      toast({
        title: "AI Analysis Complete",
        description: `Analyzed ${data.analyzedCount} deals from conversation history.`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals/analytics"] });
    } catch (err) {
      toast({
        title: "Sync Failed",
        description: "Could not refine deals with AI.",
        variant: "destructive"
      });
    }
  };



  const exportDeals = () => {
    if (deals.length === 0) {
      toast({
        title: "No data to export",
        description: "Your pipeline is currently empty.",
        variant: "destructive"
      });
      return;
    }

    const headers = ["Lead Name", "Value", "Status", "Channel", "Created At"];
    const csvContent = [
      headers.join(","),
      ...deals.map(d => [
        `"${String(d.leadName || "Unknown").replace(new RegExp('"', 'g'), '""')}"`,
        d.value || 0,
        `"${String(d.status || "").replace(new RegExp('"', 'g'), '""')}"`,
        `"${String(d.channel || "").replace(new RegExp('"', 'g'), '""')}"`,
        `"${new Date(d.createdAt).toLocaleString().replace(new RegExp('"', 'g'), '""')}"`
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `audnix-pipeline-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Pipeline Exported",
      description: `Downloaded ${deals.length} deals as CSV.`,
    });
  };

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <PremiumLoader text="Analyzing Pipeline..." />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Revenue & Pipeline
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Monitor your sales performance and active deals.
          </p>
        </div>
          <div className="relative group">
            <Button variant="outline" className="flex">
              <Filter className="mr-2 h-4 w-4" /> {filter === 'all' ? 'All Deals' : (filter as string).replace('_', ' ')}
            </Button>
            <div className="absolute right-0 mt-2 w-48 bg-card border rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
               <button onClick={() => setFilter('all')} className="w-full text-left px-4 py-2 hover:bg-muted text-sm">All Deals</button>
               <button onClick={() => setFilter('open')} className="w-full text-left px-4 py-2 hover:bg-muted text-sm">Open</button>
               <button onClick={() => setFilter('converted')} className="w-full text-left px-4 py-2 hover:bg-muted text-sm">Converted</button>
               <button onClick={() => setFilter('closed_lost')} className="w-full text-left px-4 py-2 hover:bg-muted text-sm">Closed Lost</button>
            </div>
          </div>
          <Button variant="outline" onClick={exportDeals}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button onClick={syncDeals} className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/30">
            <Sparkles className="mr-2 h-4 w-4" /> Refine with AI
          </Button>
          <Button onClick={() => setLocation('/dashboard/conversations')}>
            <Plus className="mr-2 h-4 w-4" /> Add Deal
          </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalValue > 0 ? totalValue.toLocaleString() : "0"}</div>
            <p className="text-xs text-muted-foreground mt-1">Lifetime value</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">This Week</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${weekRevenue > 0 ? weekRevenue.toLocaleString() : "0"}</div>
            <div className="flex items-center gap-1 mt-1">
              <span className={`text-xs font-medium ${weekGrowth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {weekGrowth > 0 ? '+' : ''}{weekGrowth}%
              </span>
              <span className="text-xs text-muted-foreground">vs last week</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Deals</CardTitle>
            <Package className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingDeals.length}</div>
            <p className="text-xs text-muted-foreground mt-1">In pipeline</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
            <BarChart3 className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {deals.length > 0 ? Math.round((convertedDeals.length / deals.length) * 100) : "0"}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">Conversion avg</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart Section */}
      {revenueAnalytics?.timeline && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueAnalytics.timeline}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" vertical={false} />
                <XAxis dataKey="date" className="text-xs text-muted-foreground" tickLine={false} axisLine={false} />
                <YAxis className="text-xs text-muted-foreground" tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  dot={{ fill: 'hsl(var(--background))', stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Deals List */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>

        {deals.length === 0 ? (
          <Card className="border-dashed border-2 bg-muted/5">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Package className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No deals yet</h3>
              <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                Deals will automatically appear here when your AI converts a lead.
              </p>
              <Link href="/dashboard/integrations">
                <Button>Connect Sources <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b">
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Deal Name</th>
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Value</th>
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Stage</th>
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell">Channel</th>
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground hidden md:table-cell">Date</th>
                      <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((deal) => (
                      <tr key={deal.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-4 align-middle">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs">{deal.leadName?.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{deal.leadName || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="p-4 align-middle font-medium">
                          ${deal.value ? deal.value.toLocaleString() : "0"}
                        </td>
                        <td className="p-4 align-middle">
                          <Badge variant={deal.status === 'converted' ? 'default' : 'secondary'} className="capitalize">
                            {deal.status.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="p-4 align-middle hidden md:table-cell capitalize text-muted-foreground">
                          {deal.channel}
                        </td>
                        <td className="p-4 align-middle hidden md:table-cell text-muted-foreground">
                          {formatDate(deal.createdAt)}
                        </td>
                        <td className="p-4 align-middle text-right">
                          <Link href={`/dashboard/inbox/${deal.leadId}`}>
                            <Button variant="ghost" size="sm">View</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
