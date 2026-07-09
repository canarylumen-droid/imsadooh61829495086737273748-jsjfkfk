import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity } from "lucide-react";

interface TrendData {
  date: string;
  score: number;
  bounces: number;
}

interface ReputationTrendChartProps {
  data: TrendData[];
}

export const ReputationTrendChart: React.FC<ReputationTrendChartProps> = ({ data }) => {
  return (
    <Card className="border-none bg-slate-900/40 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl overflow-hidden">
      <CardHeader className="pb-1 pt-3">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-emerald-400" />
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-slate-200">
            Reputation Trend
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[100px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#64748b' }} />
              <YAxis hide domain={[0, 100]} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }} itemStyle={{ color: '#10b981' }} />
              <Area type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorScore)" animationDuration={1500} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-white/5">
          <div>
            <span className="text-[7px] font-bold text-slate-500 uppercase">Avg</span>
            <span className="text-sm font-black text-emerald-400 ml-1.5">{data.length > 0 ? Math.round(data[data.length-1].score) : 100}</span>
          </div>
          <div className="text-right">
            <span className="text-[7px] font-bold text-slate-500 uppercase">Bounces</span>
            <span className="text-sm font-black text-slate-300 ml-1.5">{data.reduce((sum, d) => sum + d.bounces, 0)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
