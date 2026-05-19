import { useState } from "react";
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
    const [dateRange, setDateRange] = useState<7 | 30>(7);
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

    const calculatePercentageChange = (current: number, previous: number | undefined): { percentage: string; isUp: boolean; isNeutral: boolean } => {
        if (previous === undefined || previous === 0) return { percentage: "—", isUp: false, isNeutral: true };
        const change = ((current - previous) / previous) * 100;
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
            <ResponsiveGrid className="xl:grid-cols-6 lg:grid-cols-3 gap-6">
                {hasData ? (
                    <>
                        <StatCard
                            label="Total Sent"
                            value={filteredMetrics?.sent || 0}
                            icon={Send}
                            trend={calculatePercentageChange(filteredMetrics?.sent || 0, previousStats?.messages).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.sent || 0, previousStats?.messages).isUp}
                            color="text-blue-500"
                            index={0}
                        />
                        <StatCard
                            label="Open Rate"
                            value={`${isNaN(Number(filteredMetrics?.openRate)) ? "0.00" : Number(filteredMetrics?.openRate || 0).toFixed(2)}%`}
                            icon={Eye}
                            trend={calculatePercentageChange(filteredMetrics?.openRate || 0, previousStats?.openRate).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.openRate || 0, previousStats?.openRate).isUp}
                            color="text-amber-500"
                            index={1}
                        />
                        <StatCard
                            label="Response Rate"
                            value={`${isNaN(Number(filteredMetrics?.responseRate)) ? "0.00" : Number(filteredMetrics?.responseRate || 0).toFixed(2)}%`}
                            icon={MessageCircle}
                            trend={calculatePercentageChange(filteredMetrics?.responseRate || 0, previousStats?.responseRate).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.responseRate || 0, previousStats?.responseRate).isUp}
                            color="text-fuchsia-500"
                            index={2}
                        />
                        <StatCard
                            label="Revenue"
                            value={`$${(filteredMetrics?.closedRevenue || 0).toLocaleString()}`}
                            icon={DollarSign}
                            trend={calculatePercentageChange((filteredMetrics?.closedRevenue || 0), (previousStats?.closedRevenue || 0)).percentage}
                            isUp={calculatePercentageChange((filteredMetrics?.closedRevenue || 0), (previousStats?.closedRevenue || 0)).isUp}
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
                            value={filteredMetrics?.booked || 0}
                            icon={CalendarCheck2}
                            trend={calculatePercentageChange(filteredMetrics?.booked || 0, previousStats?.convertedLeads).percentage}
                            isUp={calculatePercentageChange(filteredMetrics?.booked || 0, previousStats?.convertedLeads).isUp}
                            color="text-primary"
                            index={5}
                        />
                    </>
                ) : (
                    <div className="lg:col-span-4 flex flex-col items-center justify-center py-16 text-center text-muted-foreground opacity-60">
                        <Activity className="h-8 w-8 mb-3" />
                        <p className="text-sm font-semibold tracking-wider uppercase">No data available for this period</p>
                    </div>
                )}
            </ResponsiveGrid>

            <ResponsiveGrid className="grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                {/* Main Growth Chart */}
                <Card className="lg:col-span-2 bg-card border-border/40 rounded-2xl overflow-hidden">
                    <CardHeader className="p-4 sm:p-6 md:p-8 pb-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 text-center sm:text-left">Engagement Velocity</CardTitle>
                        <div className="flex flex-wrap justify-center gap-4">
                            <div className="flex bg-muted/50 rounded-lg p-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(7)}
                                    className={cn("h-7 text-[10px] font-bold px-4", dateRange === 7 && "bg-background shadow-sm")}
                                >
                                    7 Days
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDateRange(30)}
                                    className={cn("h-7 text-[10px] font-bold px-4", dateRange === 30 && "bg-background shadow-sm")}
                                >
                                    30 Days
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
                            <ChartContainer config={chartConfig} className="h-full w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Sent', value: analytics?.metrics?.sent || 0, color: COLORS.sent_email },
                                                { name: 'Opened', value: analytics?.metrics?.opened || 0, color: COLORS.opened },
                                                { name: 'Replied', value: analytics?.metrics?.replied || 0, color: COLORS.replied_instagram },
                                            ].filter(item => item.value > 0)}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={110}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {[0, 1, 2].map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={[COLORS.sent_email, COLORS.sent_instagram, COLORS.replied_instagram][index]} stroke="transparent" />
                                            ))}
                                        </Pie>
                                        <ChartTooltip content={<ChartTooltipContent className="bg-card border-border rounded-xl" />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Real-time Activity Feed */}
                <Card className="bg-card border-border/40 rounded-2xl p-8 flex flex-col relative overflow-hidden">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-8 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" /> Live Interaction Stream
                    </h3>
                    <div className="space-y-6 flex-1">
                        {(analytics?.recentEvents || []).length > 0 ? (
                            analytics?.recentEvents.map(event => (
                                <div key={event.id} className="flex gap-4 group items-center">
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
                                                <Badge className="h-4 px-1.5 text-[8px] font-semibold bg-primary text-black border-0 animate-in fade-in zoom-in">NEW</Badge>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-1">{event.time}</p>
                                    </div>
                                </div>
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

            <ResponsiveGrid className="grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                {/* Lead Distribution Pie Chart */}
                <Card className="bg-card border-border/40 rounded-2xl overflow-hidden">
                    <CardHeader className="p-8">
                        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">Lead Status System</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px] flex items-center justify-center">
                        {analytics?.metrics ? (
                            <div className="w-full h-full flex items-center justify-center">
                                <ResponsiveContainer width="60%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Warm', value: analytics.metrics?.replied || 0, color: '#3b82f6' },
                                                { name: 'Sent', value: (analytics.metrics?.sent || 0) - (analytics.metrics?.replied || 0), color: '#d946ef' },
                                                { name: 'Converted', value: analytics.metrics?.booked || 0, color: '#10b981' }
                                            ]}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={8}
                                            dataKey="value"
                                        >
                                            {[0, 1, 2].map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={['#3b82f6', '#d946ef', '#10b981'][index]} />
                                            ))}
                                        </Pie>
                                        <ChartTooltip content={<ChartTooltipContent className="bg-card border-border rounded-xl" />} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="flex flex-col gap-3 justify-center pr-10">
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
                <Card className="bg-card border-border/40 rounded-2xl p-8 flex flex-col justify-center">
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
                        <CardDescription className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-1">Numerical breakdown by intersection cycle</CardDescription>
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
                                    <th className="px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Metric</th>
                                    <th className="px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Current Period</th>
                                    <th className="px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Previous Period</th>
                                    <th className="px-8 py-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Inertia</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {[
                                    { label: "Messages Sent", currentVal: filteredMetrics?.sent, previousVal: previousStats?.messages },
                                    { label: "Email Open Rate", current: `${Number(filteredMetrics?.openRate || 0).toFixed(2)}%`, previous: `${Number(previousStats?.openRate || 0).toFixed(2)}%`, currentVal: filteredMetrics?.openRate, previousVal: previousStats?.openRate },
                                    { label: "Engagement Rate", current: `${Number(filteredMetrics?.responseRate || 0).toFixed(2)}%`, previous: `${Number(previousStats?.responseRate || 0).toFixed(2)}%`, currentVal: filteredMetrics?.responseRate, previousVal: previousStats?.responseRate },
                                    { label: "Total Bookings", currentVal: filteredMetrics?.booked, previousVal: previousStats?.convertedLeads },
                                    { label: "Gross Revenue", current: `$${(filteredMetrics?.closedRevenue || 0).toLocaleString()}`, previous: `$${(previousStats?.closedRevenue || 0).toLocaleString()}`, currentVal: filteredMetrics?.closedRevenue, previousVal: previousStats?.closedRevenue },
                                ].map((row, idx) => {
                                    const { percentage, isUp, isNeutral } = calculatePercentageChange(
                                        Number(row.currentVal || 0),
                                        Number(row.previousVal || 0)
                                    );

                                    return (
                                        <tr key={idx} className="hover:bg-muted/20 transition-colors group">
                                            <td className="px-8 py-5 text-sm font-semibold text-foreground/80 group-hover:text-primary transition-colors">{row.label}</td>
                                            <td className="px-8 py-5 text-sm font-semibold text-right">{row.current !== undefined ? row.current : (row.currentVal || 0)}</td>
                                            <td className="px-8 py-5 text-sm font-semibold text-right opacity-45">{row.previous !== undefined ? row.previous : (row.previousVal || 0)}</td>
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
            <Card className="overflow-hidden border-border/40 hover:border-primary/20 transition-all bg-card/40 backdrop-blur-xl rounded-2xl group relative">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</CardTitle>
                    <div className={cn("p-2 rounded-xl bg-muted/50 transition-colors group-hover:bg-primary/10")}>
                        <Icon className={cn("h-4 w-4", color)} />
                    </div>
                </CardHeader>
                <CardContent className="pt-2">
                    <div className="flex items-baseline justify-between gap-1 w-full">
                        <div className="text-3xl font-bold tracking-tight truncate">{value}</div>
                        {trend && trend !== "—" && (
                            <div className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0",
                                isUp ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                            )}>
                                {isUp ? <ArrowUpRight className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
                                <span className="text-[10px] font-semibold">{trend}</span>
                            </div>
                        )}
                        {trend === "—" && (
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                                <span className="text-[10px] font-semibold">STABLE</span>
                            </div>
                        )}
                    </div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mt-4">
                      {trend && trend !== "—" ? (isUp ? "Improving" : "Declining") : "No prior data"}
                    </p>

                    <div className={cn("absolute -bottom-10 -right-10 w-32 h-32 blur-[80px] opacity-10 rounded-full", color.replace('text-', 'bg-'))} />
                </CardContent>
            </Card>
        </motion.div>
    );
}
