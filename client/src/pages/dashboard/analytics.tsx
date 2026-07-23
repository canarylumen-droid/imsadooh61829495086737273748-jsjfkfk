import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMailbox } from "@/hooks/use-mailbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    TrendingUp,
    Target,
    Mail,
    BarChart3,
    CalendarCheck2,
    ArrowUpRight,
    Sparkles,
    PieChart as PieChartIcon,
    Activity,
    Zap,
    Send,
    MessageCircle,
    Eye,
    DollarSign,
    Clock
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import {
    XAxis,
    YAxis,
    CartesianGrid,
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    AreaChart,
    Area
} from "recharts";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface AnalyticsData {
    metrics: {
        sent: number;
        opened: number;
        replied: number;
        booked: number;
        leadsFiltered: number;
        conversionRate: number;
        responseRate: number;
        openRate: number;
        closedRevenue: number;
        pipelineValue: number;
        averageResponseTime: string;
    };
    timeSeries: Array<{
        name: string;
        sent_email: number;
        sent_instagram: number;
        opened: number;
        replied_email: number;
        replied_instagram: number;
        booked: number
    }>;
    channelPerformance: Array<{ name: string; value: number }>;
    leadSourceDistribution: Array<{ name: string; value: number; color: string }>;
    recentEvents: Array<{ id: string; type: string; description: string; time: string; details?: string }>;
    isAnyConnected?: boolean;
}

const COLORS = {
    primary: "hsl(var(--primary))",
    sent_email: "#3b82f6",
    sent_instagram: "#d946ef",
    opened: "#f59e0b",
    replied_email: "#1e40af",
    replied_instagram: "#86198f",
    booked: "#10b981",
    background: "hsl(var(--background))",
    card: "hsl(var(--card))",
};

const chartConfig = {
    sent_email: { label: "Sent (Email)", color: COLORS.sent_email },
    sent_instagram: { label: "Sent (IG)", color: COLORS.sent_instagram },
    opened: { label: "Opened", color: COLORS.opened },
    replied: { label: "Replied", color: COLORS.replied_instagram },
    booked: { label: "Converted", color: COLORS.booked },
};

export default function AnalyticsPage() {
    const { socket } = useRealtime();
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!socket) return;
        const refreshFull = () => queryClient.invalidateQueries({ queryKey: ["/api/dashboard/analytics/full"] });
        const refreshInboxPlacement = () => queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] });
        const refreshStats = () => {
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/analytics/full"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats/previous"] });
        };
        socket.on("stats_updated", refreshStats);
        socket.on("deliverability_updated", refreshInboxPlacement);
        socket.on("integration_reputation_updated", refreshInboxPlacement);
        socket.on("activity_updated", refreshFull);
        socket.on("leads_updated", refreshFull);
        return () => {
            socket.off("stats_updated", refreshStats);
            socket.off("deliverability_updated", refreshInboxPlacement);
            socket.off("integration_reputation_updated", refreshInboxPlacement);
            socket.off("activity_updated", refreshFull);
            socket.off("leads_updated", refreshFull);
        };
    }, [socket, queryClient]);

    const [dateRange, setDateRange] = useState<1 | 7 | 30 | 60 | 90>(7);
    const [showEmail, setShowEmail] = useState(true);
    const [showInstagram, setShowInstagram] = useState(true);
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
    const [chartType, setChartType] = useState<'area' | 'bar'>('area');
    const { selectedMailboxId } = useMailbox();
    const { data: analytics, isLoading } = useQuery<AnalyticsData>({
        queryKey: ["/api/dashboard/analytics/full", { days: dateRange, integrationId: selectedMailboxId }],
    });

    const { data: previousStats } = useQuery<any>({
        queryKey: ["/api/dashboard/stats/previous", { integrationId: selectedMailboxId }],
    });

    const calculatePercentageChange = (current: number | null | undefined, previous: number | null | undefined): { percentage: string; isUp: boolean; isNeutral: boolean } => {
        const c = current ?? 0;
        const p = previous ?? 0;
        if (p === 0 || current === null || previous === null) return { percentage: "—", isUp: false, isNeutral: true };
        const change = ((c - p) / p) * 100;
        if (isNaN(change) || !isFinite(change)) return { percentage: "—", isUp: false, isNeutral: true };
        return {
            percentage: `${change > 0 ? "+" : ""}${change.toFixed(2)}%`,
            isUp: change > 0,
            isNeutral: Math.abs(change) < 0.001
        };
    };

    const filteredMetrics = analytics?.metrics;

    if (isLoading && !analytics) return (
        <div className="flex h-[50vh] items-center justify-center">
            <PremiumLoader text="Initializing intelligence layer..." />
        </div>
    );

    const hasData = analytics && analytics.metrics && (analytics.metrics.sent > 0 || analytics.metrics.replied > 0 || analytics.metrics.booked > 0 || analytics.isAnyConnected);

    return (
        <PageWrapper>
            {/* Summary Row */}
            <ResponsiveGrid className="grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-6">
                {hasData ? (
                    <>
                        <StatCard
                            label="Total Sent"
                            value={filteredMetrics?.sent ?? 0}
                            icon={Send}
                            trend={calculatePercentageChange(filteredMetrics?.sent, previousStats?.messages).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.sent, previousStats?.messages).isUp}
                            color="text-blue-500"
                            index={0}
                        />
                        <StatCard
                            label="Open Rate"
                            value={filteredMetrics?.openRate != null ? `${filteredMetrics.openRate.toFixed(2)}%` : "—"}
                            icon={Eye}
                            trend={calculatePercentageChange(filteredMetrics?.openRate, previousStats?.openRate).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.openRate, previousStats?.openRate).isUp}
                            color="text-amber-500"
                            index={1}
                        />
                        <StatCard
                            label="Response Rate"
                            value={filteredMetrics?.responseRate != null ? `${filteredMetrics.responseRate.toFixed(2)}%` : "—"}
                            icon={MessageCircle}
                            trend={calculatePercentageChange(filteredMetrics?.responseRate, previousStats?.responseRate).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.responseRate, previousStats?.responseRate).isUp}
                            color="text-fuchsia-500"
                            index={2}
                        />
                        <StatCard
                            label="Revenue"
                            value={filteredMetrics?.closedRevenue != null ? `$${filteredMetrics.closedRevenue.toLocaleString()}` : "—"}
                            icon={DollarSign}
                            trend={calculatePercentageChange(filteredMetrics?.closedRevenue, previousStats?.closedRevenue).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.closedRevenue, previousStats?.closedRevenue).isUp}
                            color="text-emerald-500"
                            index={3}
                        />
                        <StatCard
                            label="Avg Response"
                            value={filteredMetrics?.averageResponseTime || "—"}
                            icon={Clock}
                            trend=""
                            isUp={true}
                            color="text-indigo-500"
                            index={4}
                        />
                        <StatCard
                            label="Calls Booked"
                            value={filteredMetrics?.booked ?? 0}
                            icon={CalendarCheck2}
                            trend={calculatePercentageChange(filteredMetrics?.booked, previousStats?.convertedLeads).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.booked, previousStats?.convertedLeads).isUp}
                            color="text-primary"
                            index={5}
                        />
                    </>
                ) : (
                    <div className="lg:col-span-4 flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-12 h-12 bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/20 rounded-xl flex items-center justify-center mb-3">
                            <Activity className="h-6 w-6 text-violet-400" />
                        </div>
                        <p className="text-sm font-semibold text-foreground/80">No data available for this period</p>
                        <p className="text-xs text-muted-foreground mt-1">Send some emails to see analytics here.</p>
                    </div>
                )}
            </ResponsiveGrid>

            <ResponsiveGrid className="grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                {/* Main Growth Chart */}
                <Card className="lg:col-span-2 bg-card border-border/40 rounded-2xl">
                    <CardHeader className="p-4 sm:p-6 md:p-8 pb-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 text-center sm:text-left">Engagement Velocity</CardTitle>
                        <div className="flex flex-wrap justify-center gap-4">
                            <div className="flex bg-muted/50 rounded-lg p-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(1)}
                                    className={cn("h-7 text-[10px] font-bold px-3", dateRange === 1 && "bg-background shadow-sm")}
                                >
                                    24h
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(7)}
                                    className={cn("h-7 text-[10px] font-bold px-3", dateRange === 7 && "bg-background shadow-sm")}
                                >
                                    7d
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(30)}
                                    className={cn("h-7 text-[10px] font-bold px-3", dateRange === 30 && "bg-background shadow-sm")}
                                >
                                    30d
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(60)}
                                    className={cn("h-7 text-[10px] font-bold px-3", dateRange === 60 && "bg-background shadow-sm")}
                                >
                                    60d
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(90)}
                                    className={cn("h-7 text-[10px] font-bold px-3", dateRange === 90 && "bg-background shadow-sm")}
                                >
                                    90d
                                </Button>
                            </div>
                            {/* Chart Type Toggle */}
                            <div className="flex bg-muted/50 rounded-lg p-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setChartType("area")}
                                    className={cn("h-7 w-7 p-0", chartType === "area" && "bg-background shadow-sm")}
                                >
                                    <Activity className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setChartType("bar")}
                                    className={cn("h-7 w-7 p-0", chartType === "bar" && "bg-background shadow-sm")}
                                >
                                    <BarChart3 className="w-3.5 h-3.5" />
                                </Button>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowEmail(!showEmail)}
                                    className={cn("h-8 text-[10px] border-blue-500/30 rounded-lg", showEmail ? "bg-blue-500/10 text-blue-500" : "opacity-50")}
                                >
                                    <Mail className="w-3 h-3 mr-1" /> Email
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowInstagram(!showInstagram)}
                                    className={cn("h-8 text-[10px] border-fuchsia-500/30 rounded-lg", showInstagram ? "bg-fuchsia-500/10 text-fuchsia-500" : "opacity-50")}
                                >
                                    <TrendingUp className="w-3 h-3 mr-1" /> Instagram
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="h-[260px] sm:h-[300px] md:h-[400px] p-2 sm:p-4 md:p-8">
                        {chartType === "area" ? (
                            <ChartContainer config={chartConfig} className="w-full h-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={analytics?.timeSeries || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorSentEmail" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={COLORS.sent_email} stopOpacity={0.5} />
                                                <stop offset="95%" stopColor={COLORS.sent_email} stopOpacity={0.05} />
                                            </linearGradient>
                                            <linearGradient id="colorSentInstagram" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={COLORS.sent_instagram} stopOpacity={0.5} />
                                                <stop offset="95%" stopColor={COLORS.sent_instagram} stopOpacity={0.05} />
                                            </linearGradient>
                                            <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={COLORS.opened} stopOpacity={0.5} />
                                                <stop offset="95%" stopColor={COLORS.opened} stopOpacity={0.05} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.3} />
                                        <XAxis
                                            dataKey="name"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 600 }}
                                            dy={10}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 600 }}
                                        />
                                        <ChartTooltip
                                            cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 2, strokeDasharray: '4 4' }}
                                            content={<ChartTooltipContent className="bg-card/90 backdrop-blur-xl border-border rounded-2xl shadow-2xl p-4 min-w-[150px]" />}
                                        />

                                        {showEmail && (
                                            <Area
                                                type="monotone"
                                                dataKey="sent_email"
                                                stackId="1"
                                                stroke={COLORS.sent_email}
                                                fillOpacity={1}
                                                fill="url(#colorSentEmail)"
                                                strokeWidth={3}
                                                activeDot={{ r: 6, strokeWidth: 0, fill: COLORS.sent_email }}
                                            />
                                        )}
                                        {showInstagram && (
                                            <Area
                                                type="monotone"
                                                dataKey="sent_instagram"
                                                stackId="1"
                                                stroke={COLORS.sent_instagram}
                                                fillOpacity={1}
                                                fill="url(#colorSentInstagram)"
                                                strokeWidth={3}
                                                activeDot={{ r: 6, strokeWidth: 0, fill: COLORS.sent_instagram }}
                                            />
                                        )}
                                        <Area
                                            type="monotone"
                                            dataKey="opened"
                                            stackId="2"
                                            stroke={COLORS.opened}
                                            fillOpacity={1}
                                            fill="url(#colorOpened)"
                                            strokeWidth={3}
                                            activeDot={{ r: 6, strokeWidth: 0, fill: COLORS.opened }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </ChartContainer>
                        ) : (
                            <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                                <ResponsiveContainer width="100%" height="100%">
                                    {(() => {
                                        const pieData = [
                                            { name: 'Sent', value: Math.max(0, Number(analytics?.metrics?.sent || 0)), color: COLORS.sent_email },
                                            { name: 'Opened', value: Math.max(0, Number(analytics?.metrics?.opened || 0)), color: COLORS.opened },
                                            { name: 'Replied', value: Math.max(0, Number(analytics?.metrics?.replied || 0)), color: COLORS.replied_instagram },
                                        ].filter(item => !isNaN(item.value) && item.value > 0);

                                        if (pieData.length === 0) {
                                            return (
                                                <div className="h-full w-full flex items-center justify-center opacity-30 text-xs font-medium uppercase">
                                                    No Engagement Data
                                                </div>
                                            );
                                        }

                                        return (
                                            <PieChart>
                                                <Pie
                                                    data={pieData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={40}
                                                    outerRadius={60}
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                >
                                                    {pieData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                                                    ))}
                                                </Pie>
                                                <ChartTooltip content={<ChartTooltipContent className="bg-card border-border rounded-xl" />} />
                                            </PieChart>
                                        );
                                    })()}
                                </ResponsiveContainer>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Real-time Activity Feed */}
                <Card className="bg-card border-border/40 rounded-2xl p-4 sm:p-8 flex flex-col relative overflow-hidden">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-8 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" /> Live Interaction Stream
                    </h3>
                    <div className="space-y-6 flex-1">
                        {(analytics?.recentEvents || []).length > 0 ? (
                            (analytics?.recentEvents || []).map((event, idx) => (
                                <motion.div
                                    key={event.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className="flex gap-4 group items-center"
                                >
                                    <div className={cn(
                                        "mt-1 w-2 h-2 rounded-full shrink-0 transition-all duration-500",
                                        (event as any).isNew
                                            ? "bg-primary shadow-[0_0_15px_rgba(59,130,246,0.8)] scale-110 animate-pulse"
                                            : "bg-muted-foreground/30 shadow-none border border-white/5"
                                    )} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">{event.description}</p>
                                            {(event as any).isNew && (
                                                <Badge className="h-4 px-1.5 text-[8px] font-semibold bg-primary text-primary-foreground border-0 animate-in fade-in zoom-in">NEW</Badge>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-1">{event.time}</p>
                                    </div>
                                </motion.div>
                            ))
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center opacity-20 py-20">
                                <Zap className="w-12 h-12 mb-4" />
                                <p className="text-xs font-semibold uppercase tracking-wider">Waiting for activity...</p>
                            </div>
                        )}
                    </div>
                    <Button
                        onClick={() => setIsAuditModalOpen(true)}
                        variant="ghost"
                        className="mt-8 text-[10px] font-semibold uppercase tracking-wider text-primary p-0 h-auto justify-start hover:bg-transparent hover:text-primary/80"
                    >
                        View Transparency Audit Log <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Button>

                    <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-primary/5 blur-[60px] rounded-full" />
                </Card>
            </ResponsiveGrid>

            {/* Inbox Placement & Spam Analytics */}
            <InboxPlacementSection selectedMailboxId={selectedMailboxId} days={dateRange} />

            <ResponsiveGrid className="grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                {/* Lead Distribution Pie Chart */}
                <Card className="bg-card border-border/40 rounded-2xl">
                    <CardHeader className="p-6">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">Lead Status System</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[260px] flex items-center justify-center">
                        {analytics?.metrics ? (
                            <div className="w-full h-full flex items-center justify-center gap-4">
                                <ChartContainer config={{}} className="w-[50%] h-full aspect-auto">
                                    <ResponsiveContainer width="100%" height="100%">
                                        {(() => {
                                            const pieData = [
                                                { name: 'Warm', value: Math.max(0, Number(analytics?.metrics?.replied || 0)), color: '#3b82f6' },
                                                { name: 'Sent', value: Math.max(0, Number(analytics?.metrics?.sent || 0) - Number(analytics?.metrics?.replied || 0)), color: '#d946ef' },
                                                { name: 'Converted', value: Math.max(0, Number(analytics?.metrics?.booked || 0)), color: '#10b981' }
                                            ].filter(item => !isNaN(item.value) && item.value > 0);

                                            if (pieData.length === 0) {
                                                return (
                                                    <div className="h-full w-full flex items-center justify-center opacity-30 text-xs font-medium uppercase">
                                                        No Status Data
                                                    </div>
                                                );
                                            }

                                            return (
                                                <PieChart>
                                                    <Pie
                                                        data={pieData}
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={35}
                                                        outerRadius={55}
                                                        paddingAngle={8}
                                                        dataKey="value"
                                                    >
                                                        {pieData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                                                        ))}
                                                    </Pie>
                                                    <ChartTooltip content={<ChartTooltipContent className="bg-card border-border rounded-xl" />} />
                                                </PieChart>
                                            );
                                        })()}
                                    </ResponsiveContainer>
                                </ChartContainer>
                                <div className="flex flex-col gap-2 justify-center pr-4">
                                    {[
                                        { label: 'Warm', color: 'bg-blue-500' },
                                        { label: 'Sent', color: 'bg-fuchsia-500' },
                                        { label: 'Converted', color: 'bg-emerald-500' }
                                    ].map(item => (
                                        <div key={item.label} className="flex items-center gap-3">
                                            <div className={cn("w-2 h-2 rounded-full", item.color)} />
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="opacity-20 flex flex-col items-center">
                                <PieChartIcon className="w-12 h-12 mb-2" />
                                <p className="text-[10px] font-semibold uppercase tracking-wider">Aggregating Data...</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Audit Purpose Info */}
                <Card className="bg-card border-border/40 rounded-2xl p-4 sm:p-8 flex flex-col justify-center">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 rounded-xl bg-primary/10 text-primary">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <h3 className="text-lg font-bold tracking-tight">AI Decision Engine</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-6 font-medium">
                        Audnix logs every deterministic decision cycle. The **Transparency Audit Log** provides transparency into how the AI interprets leads, handles objections, and triggers automation rules.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-2">Transparency</div>
                            <p className="text-[11px] font-medium opacity-85 leading-snug">Track AI logic flow step-by-step.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-2">Optimization</div>
                            <p className="text-[11px] font-medium opacity-85 leading-snug">Refine rules based on failed cycles.</p>
                        </div>
                    </div>
                </Card>
            </ResponsiveGrid>

            {/* Stats Table Section */}
            <Card className="bg-card border-border/40 rounded-2xl overflow-hidden mt-6">
                <div className="p-8 border-b border-border/40 bg-muted/30 flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">Performance Matrix</CardTitle>
                        <CardDescription className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-1">Period comparison</CardDescription>
                    </div>
                    <Badge variant="outline" className="rounded-full px-4 h-6 border-primary/20 bg-primary/5 text-primary text-[8px] font-semibold tracking-wider uppercase">
                        Real-time Sync
                    </Badge>
                </div>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border/20">
                                    <th className="px-3 sm:px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Metric</th>
                                    <th className="px-3 sm:px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Current Period</th>
                                    <th className="px-3 sm:px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Previous Period</th>
                                    <th className="px-3 sm:px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Inertia</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {[
                                    { label: "Messages Sent", currentVal: filteredMetrics?.sent, previousVal: previousStats?.messages, suffix: "" },
                                    { label: "Email Open Rate", current: filteredMetrics?.openRate != null ? `${filteredMetrics.openRate.toFixed(2)}%` : "—", previous: previousStats?.openRate != null ? `${previousStats.openRate.toFixed(2)}%` : "—", currentVal: filteredMetrics?.openRate, previousVal: previousStats?.openRate, suffix: "%" },
                                    { label: "Engagement Rate", current: filteredMetrics?.responseRate != null ? `${filteredMetrics.responseRate.toFixed(2)}%` : "—", previous: previousStats?.responseRate != null ? `${previousStats.responseRate.toFixed(2)}%` : "—", currentVal: filteredMetrics?.responseRate, previousVal: previousStats?.responseRate, suffix: "%" },
                                    { label: "Total Bookings", currentVal: filteredMetrics?.booked, previousVal: previousStats?.convertedLeads, suffix: "" },
                                    { label: "Gross Revenue", current: filteredMetrics?.closedRevenue != null ? `$${filteredMetrics.closedRevenue.toLocaleString()}` : "—", previous: previousStats?.closedRevenue != null ? `$${previousStats.closedRevenue.toLocaleString()}` : "—", currentVal: filteredMetrics?.closedRevenue, previousVal: previousStats?.closedRevenue, suffix: "$" },
                                ].map((row, idx) => {
                                    const { percentage, isUp, isNeutral } = calculatePercentageChange(
                                        row.currentVal,
                                        row.previousVal
                                    );

                                    return (
                                        <tr key={idx} className="hover:bg-muted/20 transition-colors group">
                                            <td className="px-3 sm:px-8 py-5 text-sm font-semibold text-foreground/80 group-hover:text-primary transition-colors">{row.label}</td>
                                            <td className="px-3 sm:px-8 py-5 text-sm font-semibold text-right">{row.current !== undefined ? row.current : (row.currentVal || 0)}</td>
                                            <td className="px-3 sm:px-8 py-5 text-sm font-semibold text-right opacity-45">{row.previous !== undefined ? row.previous : (row.previousVal || 0)}</td>
                                            <td className="px-8 py-5 text-right">
                                                <div className={cn(
                                                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                                                    isNeutral ? "bg-muted text-muted-foreground" :
                                                        isUp ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                                                )}>
                                                    {!isNeutral && (isUp ? <ArrowUpRight className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />)}
                                                    {percentage}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Audit Logs Sheet */}
            <Sheet open={isAuditModalOpen} onOpenChange={setIsAuditModalOpen}>
                <SheetContent side="right" className="w-full sm:max-w-xl p-0 bg-background border-l border-border">
                    <div className="h-full flex flex-col">
                        <div className="p-8 border-b border-border bg-card/50">
                            <h2 className="text-xl font-bold tracking-tight flex items-center gap-3">
                                <Activity className="w-5 h-5 text-primary" /> Transparency Audit Log
                            </h2>
                            <p className="text-xs text-muted-foreground mt-1 lowercase first-letter:uppercase font-semibold">Historical trace of all AI decision cycles and lead intersections</p>
                        </div>
                        <ScrollArea className="flex-1 p-8">
                            <div className="space-y-8">
                                {(analytics?.recentEvents || []).map((event, idx) => (
                                    <div key={idx} className="relative pl-8 border-l border-border/40 pb-8 last:pb-0">
                                        <div className="absolute left-[-5px] top-0 w-[9px] h-[9px] rounded-full bg-primary shadow-[0_0_10px_#3b82f6]" />
                                        <div className="space-y-2">
                                            <div className="flex items-baseline justify-between">
                                                <h4 className="text-sm font-semibold uppercase tracking-wider">{event.type}</h4>
                                                <span className="text-[10px] font-mono opacity-40">{event.time}</span>
                                            </div>
                                            <p className="text-sm text-foreground/80 leading-relaxed font-medium">{event.description}</p>
                                            {event.details && (
                                                <div className="p-3 rounded-xl bg-muted/50 border border-border/20 text-xs font-mono opacity-60">
                                                    {event.details}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                </SheetContent>
            </Sheet>
        </PageWrapper>
    );
}

function StatCard({ label, value, icon: Icon, trend, isUp, color, index }: any) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
        >
            <Card className="overflow-hidden border-border/40 hover:border-primary/20 transition-all bg-card/40 backdrop-blur-xl rounded-2xl group relative p-3 sm:p-5">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 sm:pb-2 p-0">
                    <CardTitle className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 truncate pr-2 w-full">{label}</CardTitle>
                    <div className={cn("p-1 sm:p-2 rounded-xl bg-muted/50 transition-colors group-hover:bg-primary/10 shrink-0")}>
                        <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", color)} />
                    </div>
                </CardHeader>
                <CardContent className="pt-2 p-0">
                    <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 w-full">
                        <div className="text-lg sm:text-3xl font-bold tracking-tight truncate">{value}</div>
                        {trend && trend !== "—" && (
                            <div className={cn(
                                "flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 w-fit mt-0.5 sm:mt-0",
                                isUp ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                            )}>
                                {isUp ? <ArrowUpRight className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> : <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 rotate-180" />}
                                <span className="text-[8px] sm:text-[10px] font-semibold">{trend}</span>
                            </div>
                        )}
                    </div>
                    {trend && trend !== "—" && (
                      <p className="text-[8px] sm:text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-2 sm:mt-4">
                        {isUp ? "Improving" : "Declining"}
                      </p>
                    )}

                    <div className={cn("absolute -bottom-10 -right-10 w-32 h-32 blur-[80px] opacity-10 rounded-full", color.replace('text-', 'bg-'))} />
                </CardContent>
            </Card>
        </motion.div>
    );
}

interface InboxPlacementData {
    mailboxes: Array<{
        integrationId: string;
        sent: number;
        inbox: number;
        spam: number;
        bounce: number;
        other: number;
        inboxRate: number;
    }>;
    totals: { sent: number; inbox: number; spam: number; bounce: number; rate: string };
}

function InboxPlacementSection({ selectedMailboxId, days }: { selectedMailboxId?: string; days: number }) {
    const { data, isLoading } = useQuery<InboxPlacementData>({
        queryKey: ["/api/stats/inbox-placement", { days, integrationId: selectedMailboxId }],
    });

    if (isLoading || !data) return null;

    const { totals, mailboxes } = data;
    const displayMailboxes = selectedMailboxId
        ? mailboxes.filter(m => m.integrationId === selectedMailboxId)
        : mailboxes;

    if (totals.sent === 0 && displayMailboxes.length === 0) return null;

    const pieData = [
        { name: 'Inbox', value: totals.inbox, color: '#10b981' },
        { name: 'Spam', value: totals.spam, color: '#ef4444' },
        { name: 'Bounce', value: totals.bounce, color: '#f59e0b' },
    ].filter(d => d.value > 0);

    return (
        <ResponsiveGrid className="grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Overall Inbox Placement Pie */}
            <Card className="bg-card border-border/40 rounded-2xl">
                <CardHeader className="p-4 pb-0">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2">
                        <Target className="w-4 h-4 text-emerald-500" /> Inbox Placement
                    </CardTitle>
                </CardHeader>
                <CardContent className="h-[200px] flex items-center justify-center">
                    {pieData.length === 0 ? (
                        <p className="text-xs text-muted-foreground/40 font-semibold uppercase">No placement data</p>
                    ) : (
                        <div className="w-full flex items-center gap-3 px-3">
                            <ChartContainer config={{}} className="w-[50%] h-full aspect-auto">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={30}
                                            outerRadius={50}
                                            paddingAngle={4}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} stroke="transparent" />
                                            ))}
                                        </Pie>
                                        <ChartTooltip content={<ChartTooltipContent className="bg-card border-border rounded-xl" />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </ChartContainer>
                            <div className="flex flex-col gap-2 text-xs font-semibold">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                    <span>Inbox: {totals.inbox} ({totals.rate})</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                    <span>Spam: {totals.spam}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                                    <span>Bounce: {totals.bounce}</span>
                                </div>
                                <div className="text-muted-foreground/40 mt-1">
                                    Total sent: {totals.sent}
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Per-Mailbox Inbox Rate */}
            <Card className="bg-card border-border/40 rounded-2xl overflow-hidden lg:col-span-2">
                <CardHeader className="p-6">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2">
                        <Mail className="w-4 h-4 text-blue-500" /> Per-Mailbox Placement
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                    {displayMailboxes.length === 0 ? (
                        <p className="text-xs text-muted-foreground/40 font-semibold uppercase text-center py-8">No mailbox data</p>
                    ) : (
                        <div className="space-y-4">
                            {displayMailboxes.map(mb => (
                                <div key={mb.integrationId} className="flex items-center gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-semibold truncate text-foreground/80">{mb.integrationId.slice(0, 8)}...</span>
                                            <span className={cn(
                                                "text-xs font-bold",
                                                mb.inboxRate >= 90 ? "text-emerald-500" : mb.inboxRate >= 70 ? "text-amber-500" : "text-red-500"
                                            )}>{mb.inboxRate}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-muted/30 rounded-full overflow-hidden flex">
                                            {mb.sent > 0 && (
                                                <>
                                                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(mb.inbox / mb.sent) * 100}%` }} />
                                                    <div className="h-full bg-red-500 transition-all" style={{ width: `${(mb.spam / mb.sent) * 100}%` }} />
                                                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${(mb.bounce / mb.sent) * 100}%` }} />
                                                </>
                                            )}
                                        </div>
                                        <div className="flex gap-3 mt-1 text-[10px] font-semibold text-muted-foreground/40">
                                            <span>{mb.sent} sent</span>
                                            <span className="text-emerald-500/60">{mb.inbox} inbox</span>
                                            <span className="text-red-500/60">{mb.spam} spam</span>
                                            <span className="text-amber-500/60">{mb.bounce} bounce</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </ResponsiveGrid>
    );
}
