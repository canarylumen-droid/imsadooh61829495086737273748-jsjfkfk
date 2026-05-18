import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Copy,
  Sparkles,
  Zap,
  Brain,
  Target,
  MessageSquare,
  BookOpen,
  Shield,
  TrendingUp,
  Loader2,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  AlertCircle,
  Cpu,
} from "lucide-react";

interface ObjectionAnalysis {
  category: string;
  confidence: number;
  hiddenObjection?: string;
  reframes: string[];
  powerQuestion: string;
  closingTactic: string;
  story: string;
  identityUpgrade?: string;
  competitorAngle?: string;
  nextMove?: string;
}

const IntelligenceMap = ({ category, isAnalyzing }: { category?: string, isAnalyzing: boolean }) => {
  return (
    <div className="relative w-full h-40 flex items-center justify-center overflow-hidden mb-8 border border-border/10 bg-muted/40 rounded-3xl group">
      <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />

      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-64 h-64 bg-primary/10 blur-[80px] rounded-full animate-pulse" />
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.4em] text-primary">
              <Cpu className="w-4 h-4 animate-spin" />
              Vectorizing Intelligence
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 flex items-center gap-12">
        {[
          { label: 'Inbound', icon: MessageSquare, active: true },
          { label: 'Logic', icon: Brain, active: !!category || isAnalyzing },
          { label: 'Strategy', icon: Target, active: !!category },
          { label: 'Output', icon: Zap, active: !!category }
        ].map((node, i, arr) => (
          <div key={i} className="flex items-center gap-12">
            <div className="flex flex-col items-center gap-2">
              <motion.div
                animate={node.active ? {
                  scale: [1, 1.1, 1],
                  borderColor: node.active ? 'rgba(var(--primary), 0.5)' : 'rgba(255,255,255,0.05)'
                } : {}}
                transition={{ repeat: Infinity, duration: 3 }}
                className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition-all duration-500
                                    ${node.active ? 'bg-primary/10 border-primary/20 text-primary shadow-[0_0_20px_rgba(var(--primary),0.2)]' : 'bg-muted/50 border-border/10 text-muted-foreground/10'}
                                `}
              >
                <node.icon className="w-5 h-5" />
              </motion.div>
              <span className={`text-[8px] font-black uppercase tracking-widest ${node.active ? 'text-foreground/60' : 'text-muted-foreground/10'}`}>{node.label}</span>
            </div>
            {i < arr.length - 1 && (
              <div className="w-12 h-px bg-border/20 relative">
                {node.active && (
                  <motion.div
                    initial={{ x: "-100%" }}
                    animate={{ x: "100%" }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-primary to-transparent"
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default function CloserEngineLive() {
  const [prospectText, setProspectText] = useState("");
  const [analysis, setAnalysis] = useState<ObjectionAnalysis | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    reframe: true,
    question: true,
    close: true,
  });
  const { toast } = useToast();

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const analyzeMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await fetch("/api/sales-engine/analyze-objection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectMessage: text }),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to analyze objection");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setAnalysis(data);
      toast({
        title: "Objection Decoded",
        description: "Your tactical close is ready",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAnalyze = () => {
    if (!prospectText.trim()) {
      toast({
        title: "Enter prospect message",
        description: "Paste what the prospect said during the call",
        variant: "destructive",
      });
      return;
    }
    analyzeMutation.mutate(prospectText);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard`,
    });
  };

  const CopyButton = ({ text, label }: { text: string; label: string }) => (
    <button
      onClick={() => copyToClipboard(text, label)}
      className="flex-shrink-0 p-2 rounded-xl bg-primary/10 hover:bg-primary/20 transition-all active:scale-90 group cursor-none"
    >
      <Copy className="h-4 w-4 text-primary group-hover:scale-110 transition-transform" />
    </button>
  );

  const CollapsibleSection = ({
    id,
    icon: Icon,
    title,
    content,
    badge,
    accentColor = "primary",
  }: {
    id: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    content: string;
    badge?: string;
    accentColor?: string;
  }) => {
    const isExpanded = expandedSections[id];

    // Map theme colors
    const themes = {
      primary: { border: "border-primary/20", bg: "bg-primary/5", text: "text-primary", icon: "text-primary", badge: "bg-primary/10" },
      purple: { border: "border-purple-500/20", bg: "bg-purple-500/5", text: "text-purple-500", icon: "text-purple-400", badge: "bg-purple-500/10" },
      emerald: { border: "border-emerald-500/20", bg: "bg-emerald-500/5", text: "text-emerald-500", icon: "text-emerald-400", badge: "bg-emerald-500/10" },
      orange: { border: "border-orange-500/20", bg: "bg-orange-500/5", text: "text-orange-500", icon: "text-orange-400", badge: "bg-orange-500/10" },
      blue: { border: "border-blue-500/20", bg: "bg-blue-500/5", text: "text-blue-500", icon: "text-blue-400", badge: "bg-blue-500/10" },
    };

    const theme = themes[accentColor as keyof typeof themes] || themes.primary;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`rounded-[2rem] border transition-all duration-500 ${theme.border} ${theme.bg} overflow-hidden`}
      >
        <button
          onClick={() => toggleSection(id)}
          className="w-full p-6 flex items-center justify-between cursor-none group"
        >
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl bg-card border border-border/10 group-hover:scale-110 transition-transform`}>
              <Icon className={`w-5 h-5 ${theme.icon}`} />
            </div>
            <div className="text-left">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/30 block mb-0.5">{badge || 'ANALYSIS OUTPUT'}</span>
              <span className="text-lg font-black text-foreground uppercase tracking-tight">{title}</span>
            </div>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground/30" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground/30" />
          )}
        </button>
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            >
              <div className="px-6 pb-6 mt-2">
                <div className="p-6 rounded-2xl bg-background/50 border border-border flex items-start gap-4 shadow-inner">
                  <p className="text-md text-foreground flex-1 leading-relaxed font-bold tracking-tight">{content}</p>
                  <CopyButton text={content} label={title} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };


  return (
    <div className="p-4 md:p-12 lg:p-20 max-w-7xl mx-auto selection:bg-primary selection:text-black min-h-screen">
      <div className="space-y-12">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-8"
        >
          <div className="space-y-4">
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full border border-white/10 bg-white/5">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Live Intelligence Active</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-foreground uppercase tracking-tighter leading-[0.85]">
              Closer Engine <br /> <span className="text-primary">Live.</span>
            </h1>
            <p className="text-muted-foreground font-bold text-xl md:text-2xl max-w-xl leading-tight">
              Input prospect resistance. Receive <span className="text-foreground">deterministic</span> closing strategies.
            </p>
          </div>

        </motion.div>

        <IntelligenceMap category={analysis?.category} isAnalyzing={analyzeMutation.isPending} />

        <div className="grid lg:grid-cols-5 gap-12 items-start">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 space-y-6"
          >
            <Card className="p-10 rounded-[3rem] border-border/40 bg-card/40 backdrop-blur-xl space-y-8 relative overflow-hidden group shadow-2xl">
              <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />

              <div className="space-y-2 relative z-10">
                <h3 className="text-xs font-black uppercase tracking-[0.4em] text-primary">Input Vector</h3>
                <h4 className="text-2xl font-black text-foreground uppercase tracking-tight">Intercept Objection</h4>
              </div>

              <div className="relative z-10">
                <Textarea
                  placeholder='e.g., "The price is too high for our current budget..."'
                  value={prospectText}
                  onChange={(e) => setProspectText(e.target.value)}
                  className="min-h-60 rounded-[2.5rem] bg-background/50 border-border/40 text-foreground placeholder:text-muted-foreground/20 focus:border-primary/50 text-xl font-bold tracking-tight leading-relaxed resize-none p-10 transition-all cursor-none shadow-inner"
                />
              </div>

              <Button
                onClick={handleAnalyze}
                disabled={analyzeMutation.isPending || !prospectText.trim()}
                className="w-full h-24 rounded-[2rem] bg-white text-black font-black uppercase tracking-[0.3em] shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all text-xs cursor-none"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    <Target className="w-5 h-5 mr-3" />
                    Analyze & Overcome
                  </>
                )}
              </Button>

              <div className="flex items-center justify-center gap-6 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/30 relative z-10">
                <Sparkles className="w-3 h-3 text-primary" />
                AI-powered objection analysis
              </div>
            </Card>
          </motion.div>

          <div className="lg:col-span-3">
            <AnimatePresence mode="wait">
              {analysis ? (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -30 }}
                  className="space-y-6"
                >
                  <div className="p-8 rounded-[2.5rem] border-orange-500/20 bg-orange-500/[0.05] flex items-center justify-between mb-10 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                        <AlertCircle className="w-6 h-6 text-orange-500" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-orange-500/40 block mb-1">Inferred Psychological Subtext</span>
                        <h3 className="text-xl font-black text-foreground uppercase tracking-tight">
                          {analysis.hiddenObjection || analysis.category}
                        </h3>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30 block mb-1">Confidence</span>
                      <span className="text-2xl font-black text-foreground tracking-tighter">{analysis.confidence}%</span>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <CollapsibleSection
                      id="reframe"
                      icon={Lightbulb}
                      title="Intelligent Reframe"
                      content={analysis.reframes[0]}
                      badge="Perspective Shift"
                      accentColor="primary"
                    />

                    <CollapsibleSection
                      id="question"
                      icon={Target}
                      title="Force Multiplier"
                      content={analysis.powerQuestion}
                      badge="Power Question"
                      accentColor="purple"
                    />

                    <CollapsibleSection
                      id="close"
                      icon={TrendingUp}
                      title="Closing Strategy"
                      content={analysis.closingTactic}
                      badge="Immediate Close"
                      accentColor="emerald"
                    />

                    {analysis.story && (
                      <CollapsibleSection
                        id="story"
                        icon={BookOpen}
                        title="Persuasion Narrative"
                        content={analysis.story}
                        badge="Social Proof"
                        accentColor="orange"
                      />
                    )}

                    {analysis.identityUpgrade && (
                      <CollapsibleSection
                        id="identity"
                        icon={Shield}
                        title="Identity Alignment"
                        content={analysis.identityUpgrade}
                        badge="Future Self"
                        accentColor="blue"
                      />
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    className="w-full h-16 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/30 hover:text-foreground transition-all cursor-none border-border/10 mt-8"
                    onClick={() => {
                      setProspectText("");
                      setAnalysis(null);
                    }}
                  >
                    Reset Vector
                  </Button>
                </motion.div>
              ) : (
                <Card className="h-full flex flex-col items-center justify-center p-20 bg-card/40 backdrop-blur-xl rounded-[4rem] border-border/10 text-center space-y-8 shadow-2xl">
                  <div className="w-24 h-24 rounded-full bg-muted/20 flex items-center justify-center border border-border/10 mb-4">
                    <Brain className="w-10 h-10 text-muted-foreground/30 animate-pulse" />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-3xl font-black text-foreground uppercase tracking-tighter">Awaiting Signal.</h3>
                    <p className="text-muted-foreground font-medium text-lg max-w-sm mx-auto leading-tight">
                      System initialized. Paste the exact verbatim from your call to extract the tactical advantage.
                    </p>
                  </div>
                </Card>
              )}
            </AnimatePresence>
          </div>
        </div>


      </div>
    </div>
  );
}
