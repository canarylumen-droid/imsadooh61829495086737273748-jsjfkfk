import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, Calendar, Mail, AlertTriangle, CheckCircle2, MoreHorizontal, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";

export interface AIActionLog {
  id: string;
  actionType: 'calendar_booking' | 'video_sent' | 'dm_sent' | 'follow_up' | 'objection_handled';
  decision: 'act' | 'skip' | 'wait' | 'escalate';
  confidence: number;
  intentScore: number;
  reasoning: string;
  outcome?: string;
  leadName?: string;
  createdAt: string;
}

interface AutonomousActionFeedProps {
  logs: AIActionLog[];
}

export const AutonomousActionFeed: React.FC<AutonomousActionFeedProps> = ({ logs }) => {
  return (
    <Card className="border-none bg-gradient-to-br from-slate-900/50 to-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden ring-1 ring-white/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-1">
          <CardTitle className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400 fill-yellow-400/20" />
            Autonomous Activity
          </CardTitle>
          <CardDescription className="text-slate-400 text-sm">
            Real-time Level 5 Engine decisions
          </CardDescription>
        </div>
        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse">
          Live Engine
        </Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {logs && logs.length > 0 ? (
              logs.map((log, index) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative pl-8 pb-4 border-l border-white/5 last:border-0"
                >
                  <div className="absolute left-[-9px] top-1">
                    {log.decision === 'act' ? (
                      <div className="w-4 h-4 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] ring-4 ring-slate-900" />
                    ) : log.decision === 'skip' ? (
                      <div className="w-4 h-4 rounded-full bg-slate-500 ring-4 ring-slate-900" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] ring-4 ring-slate-900" />
                    )}
                  </div>
                  
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all group">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {log.actionType === 'calendar_booking' ? (
                          <Calendar className="w-4 h-4 text-blue-400" />
                        ) : log.actionType === 'video_sent' ? (
                          <Zap className="w-4 h-4 text-purple-400" />
                        ) : log.actionType === 'objection_handled' ? (
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Mail className="w-4 h-4 text-indigo-400" />
                        )}
                        <span className="font-semibold text-slate-200 uppercase tracking-wider text-[10px]">
                          {log.actionType.replace('_', ' ')}
                        </span>
                        {log.leadName && (
                          <span className="text-slate-400 text-xs">for {log.leadName}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium italic">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    <p className="text-sm text-slate-300 leading-relaxed mb-3">
                      {log.reasoning}
                    </p>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <div className="text-[10px] uppercase text-slate-500 font-bold">Intent</div>
                        <Badge variant="secondary" className="bg-slate-800 text-slate-300 text-[10px] h-5">
                          {log.intentScore}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="text-[10px] uppercase text-slate-500 font-bold">Confidence</div>
                        <Badge variant="secondary" className="bg-slate-800 text-slate-300 text-[10px] h-5">
                          {Math.round(log.confidence * 100)}%
                        </Badge>
                      </div>
                      {log.outcome && (
                        <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium ml-auto">
                          <CheckCircle2 className="w-3 h-3" />
                          {log.outcome}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-40 opacity-50 space-y-2">
                <MoreHorizontal className="w-8 h-8 text-slate-600 animate-pulse" />
                <p className="text-sm text-slate-500">Awaiting autonomous signals...</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
