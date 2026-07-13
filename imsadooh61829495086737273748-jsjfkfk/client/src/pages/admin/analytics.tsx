import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp, DollarSign, Users, Target } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface UserGrowthDataPoint {
  date: string;
  new_users: number;
  total_users: number;
}

interface UserGrowthResponse {
  growth: UserGrowthDataPoint[];
}

interface RevenueDataPoint {
  date: string;
  revenue: number;
}

interface RevenueResponse {
  revenue: RevenueDataPoint[];
}

interface ChannelDataPoint {
  channel: string;
  total_leads: number;
  conversions: number;
  conversion_rate: number;
}

interface ChannelsResponse {
  channels: ChannelDataPoint[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function AdminAnalytics() {
  const [days, setDays] = useState("30");

  const { data: userGrowth } = useQuery<UserGrowthResponse>({
    queryKey: [`/api/admin/analytics/user-growth`, { days }],
  });

  const { data: revenue } = useQuery<RevenueResponse>({
    queryKey: [`/api/admin/analytics/revenue`, { days }],
  });

  const { data: channels } = useQuery<ChannelsResponse>({
    queryKey: [`/api/admin/analytics/channels`],
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
            <p className="text-muted-foreground">Track growth, revenue, and performance metrics</p>
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* User Growth Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              User Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{}} className="h-[300px] w-full">
              <LineChart data={userGrowth?.growth || []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis className="text-xs" />
                <ChartTooltip
                  content={<ChartTooltipContent />}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="new_users"
                  stroke="#3b82f6"
                  name="New Users"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="total_users"
                  stroke="#10b981"
                  name="Total Users"
                  strokeWidth={2}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Revenue Tracking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{}} className="h-[300px] w-full">
              <BarChart data={revenue?.revenue || []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis className="text-xs" />
                <ChartTooltip
                  content={<ChartTooltipContent />}
                />
                <Legend />
                <Bar
                  dataKey="revenue"
                  fill="#10b981"
                  name="Revenue"
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Channel Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-600" />
                Channel Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={{}} className="h-[300px] w-full">
                <PieChart>
                  <Pie
                    data={channels?.channels || []}
                    dataKey="total_leads"
                    nameKey="channel"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(entry: ChannelDataPoint) => `${entry.channel}: ${entry.total_leads}`}
                  >
                    {(channels?.channels || []).map((entry: ChannelDataPoint, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                  />
                  <Legend />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Conversion Rates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-600" />
                Conversion Rates by Channel
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {channels?.channels?.map((channel: ChannelDataPoint, index: number) => (
                  <div key={channel.channel} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium capitalize">{channel.channel}</span>
                      <span className="text-muted-foreground">
                        {channel.conversion_rate}% ({channel.conversions}/{channel.total_leads})
                      </span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, channel.conversion_rate)}%`,
                          backgroundColor: COLORS[index % COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
                {(!channels?.channels || channels.channels.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No channel data available yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
