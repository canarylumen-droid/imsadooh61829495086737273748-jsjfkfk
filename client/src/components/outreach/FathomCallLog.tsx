import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  Video, 
  FileText, 
  MessageSquare, 
  Calendar, 
  ExternalLink,
  PlayCircle,
  Sparkles,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Lightbulb,
  HeartPulse,
  Activity,
  Mic,
  Target
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { FathomCall } from "@shared/schema";

interface FathomCallLogProps {
  leadId: string;
}

export const FathomCallLog: React.FC<FathomCallLogProps> = ({ leadId }) => {
  const { data: calls, isLoading, error } = useQuery<FathomCall[]>({
    queryKey: [`/api/leads/${leadId}/fathom-calls`],
    enabled: !!leadId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl bg-muted/50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-sm text-red-500 bg-red-500/10 rounded-lg border border-red-500/20">
        Failed to load meeting history
      </div>
    );
  }

  if (!calls || calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-muted/20 border border-dashed border-muted/30 rounded-xl">
        <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
          <Video className="h-6 w-6 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-semibold">No recorded meetings found</p>
        <p className="text-xs text-muted-foreground/60 max-w-[220px] mt-1 leading-relaxed">
          Meetings recorded via Fathom will automatically appear here once processed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {calls.map((call) => (
        <Card key={call.id} className="overflow-hidden border-muted/60 bg-card/40 backdrop-blur-md group hover:border-primary/30 transition-all duration-300 shadow-sm hover:shadow-md">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <CardTitle className="text-sm font-bold leading-tight group-hover:text-primary transition-colors truncate">
                  {call.title}
                </CardTitle>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  <Calendar className="h-3 w-3 text-primary/60" />
                  {format(new Date(call.occurredAt), 'MMM d, yyyy • h:mm a')}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[9px] uppercase font-bold tracking-tighter h-5 px-1.5">
                  Fathom AI
                </Badge>
                {call.analysis?.outcome && (
                  <Badge 
                    className={`text-[9px] uppercase font-bold h-5 px-1.5 border-none ${
                      call.analysis.outcome === 'closed' ? 'bg-emerald-500/20 text-emerald-500' :
                      call.analysis.outcome === 'followed_up' ? 'bg-amber-500/20 text-amber-500' :
                      call.analysis.outcome === 'lost' ? 'bg-rose-500/20 text-rose-500' :
                      'bg-slate-500/20 text-slate-500'
                    }`}
                  >
                    {call.analysis.outcome === 'closed' && <CheckCircle2 className="w-2.5 h-2.5 mr-1" />}
                    {call.analysis.outcome === 'followed_up' && <Clock className="w-2.5 h-2.5 mr-1" />}
                    {call.analysis.outcome === 'lost' && <XCircle className="w-2.5 h-2.5 mr-1" />}
                    {call.analysis.outcome}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 pt-2 space-y-4">
            {call.videoUrl && (
              <div className="relative aspect-video rounded-lg overflow-hidden border border-muted-foreground/10 bg-slate-950 group/video shadow-inner">
                {call.videoThumbnail ? (
                  <img 
                    src={call.videoThumbnail} 
                    alt={call.title || 'Call Recording'} 
                    className="w-full h-full object-cover opacity-70 group-hover/video:scale-105 group-hover/video:opacity-90 transition-all duration-700"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950">
                    <Video className="h-10 w-10 text-white/10" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover/video:opacity-100 transition-all duration-300">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="rounded-full w-14 h-14 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-xl shadow-2xl scale-90 group-hover/video:scale-100 transition-all duration-500"
                    onClick={() => { if (call.videoUrl) window.open(call.videoUrl, '_blank'); }}
                  >
                    <PlayCircle className="h-10 w-10 text-white" />
                  </Button>
                </div>
                <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[9px] text-white font-bold uppercase tracking-widest opacity-0 group-hover/video:opacity-100 transition-opacity">
                  Play Recording
                </div>
              </div>
            )}

            {call.analysis?.coaching && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-primary tracking-tight">
                  <Sparkles className="h-4 w-4" />
                  Autonomous Sales Coaching
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 uppercase">
                      <TrendingUp className="h-3 w-3" /> Strengths
                    </div>
                    <ul className="space-y-1">
                      {call.analysis.coaching.strengths?.map((s, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground leading-tight flex items-start gap-1.5">
                          <span className="mt-1 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600 uppercase">
                      <AlertCircle className="h-3 w-3" /> Improvements
                    </div>
                    <ul className="space-y-1">
                      {call.analysis.coaching.improvements?.map((s, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground leading-tight flex items-start gap-1.5">
                          <span className="mt-1 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {call.analysis.coaching.progressAudit && (
                  <div className="mt-2 p-2 bg-indigo-500/10 rounded border border-indigo-500/20">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase mb-1">
                      <Sparkles className="h-3 w-3" /> Progress Audit (Memory)
                    </div>
                    <p className="text-[10px] text-indigo-600/80 font-medium leading-relaxed">
                      {call.analysis.coaching.progressAudit}
                    </p>
                  </div>
                )}

                {call.analysis.bookingFailureReason && (
                  <div className="mt-2 p-2 bg-rose-500/10 rounded border border-rose-500/20">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-600 uppercase mb-1">
                      <XCircle className="h-3 w-3" /> Booking Diagnostic
                    </div>
                    <p className="text-[10px] text-rose-600/80 font-medium">
                      {call.analysis.bookingFailureReason}
                    </p>
                  </div>
                )}

                {/* Talk Ratio and Sentiment */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-primary/10">
                  {call.analysis.talkRatio !== undefined && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-500 uppercase">
                        <Activity className="h-3 w-3" /> Voice Ratio
                      </div>
                      <div className="h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                        <div 
                           className="h-full bg-indigo-500 transition-all duration-1000" 
                           style={{ width: `${call.analysis.talkRatio}%` }} 
                        />
                        <div 
                           className="h-full bg-emerald-500 transition-all duration-1000" 
                           style={{ width: `${100 - call.analysis.talkRatio}%` }} 
                        />
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground font-bold uppercase">
                        <span>You ({call.analysis.talkRatio}%)</span>
                        <span>Prospect ({100 - call.analysis.talkRatio}%)</span>
                      </div>
                    </div>
                  )}

                  {call.analysis.sentimentPivot && (
                     <div className="space-y-1.5">
                      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase ${call.analysis.sentimentPivot.shift === 'positive' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        <HeartPulse className="h-3 w-3" /> Sentiment Pivot ({call.analysis.sentimentPivot.shift})
                      </div>
                      <p className="text-[10px] text-muted-foreground italic border-l-2 border-primary/20 pl-2">
                        "{call.analysis.sentimentPivot.quote}"
                      </p>
                    </div>
                  )}
                </div>

                {/* BANT Extraction */}
                {call.analysis.bant && Object.keys(call.analysis.bant).length > 0 && (
                   <div className="pt-3 border-t border-primary/10 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-500 uppercase">
                        <Target className="h-3 w-3" /> BANT Extracted Data
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                         {call.analysis.bant.budget && <div className="text-[10px]"><span className="font-bold text-muted-foreground">Budget:</span> {call.analysis.bant.budget}</div>}
                         {call.analysis.bant.authority && <div className="text-[10px]"><span className="font-bold text-muted-foreground">Authority:</span> {call.analysis.bant.authority}</div>}
                         {call.analysis.bant.need && <div className="text-[10px]"><span className="font-bold text-muted-foreground">Need:</span> {call.analysis.bant.need}</div>}
                         {call.analysis.bant.timeline && <div className="text-[10px]"><span className="font-bold text-muted-foreground">Timeline:</span> {call.analysis.bant.timeline}</div>}
                      </div>
                   </div>
                )}

                <div className="pt-2 border-t border-primary/10 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary/80 uppercase">
                    <Lightbulb className="h-3 w-3 text-amber-500" /> Next Best Action
                  </div>
                  <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary border-none font-bold">
                    {call.analysis.suggestedAction}
                  </Badge>
                </div>
              </div>
            )}

            <Accordion type="single" collapsible className="w-full space-y-1">

              {call.summary && (
                <AccordionItem value="summary" className="border-none bg-muted/20 rounded-lg overflow-hidden transition-colors hover:bg-muted/30">
                  <AccordionTrigger className="px-3 py-2 text-[11px] font-bold hover:no-underline [&[data-state=open]]:bg-primary/5 [&[data-state=open]]:text-primary">
                    <div className="flex items-center gap-2">
                       <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
                        <MessageSquare className="h-3 w-3 text-primary" />
                      </div>
                      AI Summary
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-3 text-[11px] text-muted-foreground leading-relaxed">
                    <div className="prose prose-xs dark:prose-invert max-w-none font-medium">
                      {call.summary.split('\n').filter(p => p.trim()).map((para, i) => (
                        <p key={i} className="mb-2 last:mb-0">{para}</p>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {call.transcript && (
                <AccordionItem value="transcript" className="border-none bg-muted/20 rounded-lg overflow-hidden transition-colors hover:bg-muted/30">
                  <AccordionTrigger className="px-3 py-2 text-[11px] font-bold hover:no-underline [&[data-state=open]]:bg-primary/5 [&[data-state=open]]:text-primary">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
                        <FileText className="h-3 w-3 text-primary" />
                      </div>
                      Full Transcript
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <ScrollArea className="h-[250px] w-full bg-slate-950/50 p-3">
                      <div className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono leading-relaxed selection:bg-primary/30 selection:text-white">
                        {call.transcript}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>

            {!call.videoUrl && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full h-9 text-[10px] font-bold uppercase tracking-wider border-primary/20 hover:bg-primary/5 border-primary/40 hover:text-primary transition-all shadow-sm"
                onClick={() => window.open(`https://app.fathom.ai/meetings/${call.fathomMeetingId}`, '_blank')}
              >
                Open in Fathom <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
