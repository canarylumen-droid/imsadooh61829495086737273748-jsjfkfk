import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageWrapper } from "@/components/ui/page-wrapper";
import {
  Sparkles,
  Terminal,
  Play,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  Code,
  Check,
  ChevronDown,
  ChevronUp
} from "lucide-react";

interface SimulationResult {
  reply: string;
  debug: {
    matchedObjections: string[];
    customKnowledgeApplied: boolean;
    systemPrompt: string;
  };
}

export default function SandboxPage() {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const simulateMutation = useMutation({
    mutationFn: async (msg: string) => {
      const response = await apiRequest("POST", "/api/custom-training/simulate", { message: msg });
      return response.json() as Promise<SimulationResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: "Simulation complete",
        description: "AI response generated successfully based on your custom rules.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Simulation failed",
        description: err.message || "Failed to generate simulated response.",
        variant: "destructive",
      });
    }
  });

  const handleSimulate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      toast({
        title: "Validation error",
        description: "Please enter a test message.",
        variant: "destructive",
      });
      return;
    }
    simulateMutation.mutate(message);
  };

  return (
    <PageWrapper className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border/10 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Terminal className="w-6 h-6 text-primary" />
            AI Sandbox Simulator
          </h1>
          <p className="text-muted-foreground mt-1">
            Test how the AI handles complex objections and pitches your offers in real-time before going live.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Panel: Simulator Form & Output */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="border border-border/40 rounded-2xl bg-card/60 backdrop-blur-md">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-base font-bold text-foreground">Test Lead Message</CardTitle>
              <CardDescription>
                Simulate a message sent by a prospect/lead (e.g., objections about price, timing, or competitors).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <form onSubmit={handleSimulate} className="space-y-4">
                <Textarea
                  placeholder='e.g., "I like the offer, but it is way too expensive. We are currently using a cheaper agency and it is working okay for us."'
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="bg-muted/40 border-border/40 rounded-xl resize-none"
                />
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    Simulates inference using your active trained rules
                  </span>
                  <Button
                    type="submit"
                    disabled={simulateMutation.isPending}
                    className="bg-primary hover:bg-primary/95 text-black font-bold uppercase tracking-wider text-xs px-5 py-2.5 rounded-xl flex items-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {simulateMutation.isPending ? "Generating..." : "Simulate Response"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* AI Response Output */}
          <Card className="border border-border/40 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-md">
            <CardHeader className="p-6 pb-4 border-b border-border/10 bg-muted/20">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Simulated AI Output
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 min-h-[160px] flex flex-col justify-between">
              {simulateMutation.isPending ? (
                <div className="space-y-3 py-4 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-4 bg-muted rounded w-5/6"></div>
                  <div className="h-4 bg-muted rounded w-2/3"></div>
                </div>
              ) : result ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                    <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                      {result.reply}
                    </p>
                  </div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-500" />
                    Response successfully optimized using custom settings.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs italic">
                  Enter a message and hit "Simulate Response" to generate results.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel: Debug Context & Prompt Inspector */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border border-border/40 rounded-2xl bg-card/60 backdrop-blur-md">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-base font-bold text-foreground">Inference Debugger</CardTitle>
              <CardDescription>
                Inspect how the Custom Objection rules and Knowledge Base segments were dynamically selected.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-6">
              {result ? (
                <div className="space-y-6">
                  {/* Knowledge Base Status */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Knowledge base</h3>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={result.debug.customKnowledgeApplied ? "default" : "outline"}
                        className={result.debug.customKnowledgeApplied ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : ""}
                      >
                        {result.debug.customKnowledgeApplied ? "Custom Context Applied" : "No Context Found"}
                      </Badge>
                    </div>
                  </div>

                  {/* Matched Objections */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Matched Objection Rules</h3>
                    {result.debug.matchedObjections.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {result.debug.matchedObjections.map((obj, i) => (
                          <Badge key={i} className="bg-primary/20 text-primary border-primary/30">
                            {obj}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No custom objection rules matched.</p>
                    )}
                  </div>

                  {/* Collapsible System Prompt */}
                  <div className="border-t border-border/10 pt-4">
                    <button
                      onClick={() => setShowPrompt(!showPrompt)}
                      className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Code className="w-4 h-4" /> System Prompt Debugger
                      </span>
                      {showPrompt ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showPrompt && (
                      <pre className="mt-4 p-4 rounded-xl bg-muted/40 text-[10px] text-muted-foreground overflow-x-auto max-h-[300px] border border-border/40 font-mono whitespace-pre-wrap">
                        {result.debug.systemPrompt}
                      </pre>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground text-xs italic">
                  Run a simulation to populate debugger metrics.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}
