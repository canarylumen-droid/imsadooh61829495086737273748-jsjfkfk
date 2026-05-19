
import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { PageWrapper } from "@/components/ui/page-wrapper";
import {
  Copy,
  Sparkles,
  Zap,
  Brain,
  Target,
  MessageSquare,
  BookOpen,
  ArrowRight,
  Shield,
  TrendingUp,
  Loader2,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  AlertCircle,
  Check,
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

export default function SalesAssistant() {
  const [prospectText, setProspectText] = useState("");
  const [analysis, setAnalysis] = useState<ObjectionAnalysis | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    reframe: true,
    question: true,
    close: true,
    story: false,
    identity: false,
    competitor: false,
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

  const CopyButton = ({ text, label }: { text: string; label: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
      copyToClipboard(text, label);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <button
        onClick={handleCopy}
        className={`flex-shrink-0 p-2.5 rounded-xl transition-all duration-300 ${copied ? 'bg-emerald-500/20' : 'bg-primary/10 hover:bg-primary/20 active:scale-90'} group`}
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.div
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
            >
              <Check className="w-4 h-4 text-emerald-400" />
            </motion.div>
          ) : (
            <motion.div
              key="copy"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
            >
              <Copy className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    );
  };

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

    const theme = themes[accentColor as keyof typeof themes];

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`rounded-2xl border transition-all duration-500 ${theme.border} ${theme.bg} overflow-hidden group`}
      >
        <button
          onClick={() => toggleSection(id)}
          className="w-full p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-card border border-border/10`}>
              <Icon className={`w-4 h-4 ${theme.icon}`} />
            </div>
            <span className="font-semibold text-foreground">{title}</span>
            {badge && (
              <Badge variant="secondary" className={`${theme.badge} ${theme.text} text-[10px] uppercase tracking-wide border-0`}>
                {badge}
              </Badge>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
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
              <div className="px-6 pb-6">
                <div className="p-6 rounded-2xl bg-background/50 border border-border/40 flex items-start gap-4">
                  <p className="text-md text-foreground/90 flex-1 leading-relaxed font-bold tracking-tight">{content}</p>
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
    <PageWrapper className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent flex items-center gap-2">
            Sales Assistant <Brain className="h-8 w-8 text-primary" />
          </h1>
          <p className="text-muted-foreground text-base">
            Your AI partner for objection handling and closing.
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-primary/30 text-primary gap-2 px-3 py-1">
          <Sparkles className="h-3 w-3" /> Powered by GPT-4o
        </Badge>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Input Panel */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="h-full"
        >
          <Card className="h-full border-border/40 shadow-xl bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden grayscale-[0.5] hover:grayscale-0 transition-all duration-700">
            <CardHeader className="p-10 pb-4">
              <CardTitle className="flex items-center gap-3 text-xl font-bold uppercase tracking-tight text-foreground">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                  <MessageSquare className="w-6 h-6" />
                </div>
                Prospect Input
              </CardTitle>
              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">
                Verbatim Intelligence Analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Textarea
                  placeholder='e.g., "I need to think about it..." or "Send me more info"'
                  value={prospectText}
                  onChange={(e) => setProspectText(e.target.value)}
                  className="min-h-[300px] resize-none p-4 text-base leading-relaxed bg-muted/40 border-border focus:border-cyan-500/50 transition-colors rounded-xl shadow-inner"
                />
                <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded-md border border-border/50">
                  {prospectText.length} chars
                </div>
              </div>

              <Button
                onClick={handleAnalyze}
                disabled={analyzeMutation.isPending || !prospectText.trim()}
                className="w-full h-11 text-xs font-bold uppercase tracking-wider shadow-md shadow-primary/10 rounded-xl bg-primary hover:bg-primary/90 transition-all active:scale-98"
                size="lg"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                    Calculating Velocity...
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 mr-3 fill-current" />
                    Decode & Destroy
                  </>
                )}
              </Button>

              <div className="flex justify-center gap-4 text-xs text-muted-foreground pt-2">
                <span className="flex items-center gap-1"><Brain className="h-3 w-3" /> Cognitive Analysis</span>
                <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Objection Detection</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Results Panel */}
        <AnimatePresence mode="wait">
          {analysis ? (
            <motion.div
              key="results"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ delay: 0.1 }}
              className="space-y-4"
            >
              <Card className="bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20 overflow-hidden relative">
                <div className="absolute right-0 top-0 p-3 opacity-20"><TrendingUp className="h-16 w-16 text-emerald-500" /></div>
                <CardHeader className="pb-3 relative z-10">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <AlertCircle className="w-5 h-5 text-emerald-500" />
                      Analysis Complete
                    </CardTitle>
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                      {analysis.confidence}% Match
                    </Badge>
                  </div>
                  <div className="mt-2 p-3 rounded-lg bg-card/60 border border-emerald-500/20 backdrop-blur-sm shadow-inner">
                    <p className="text-sm font-medium text-foreground">
                      Detected: <span className="text-emerald-500">{analysis.hiddenObjection || analysis.category}</span>
                    </p>
                  </div>
                </CardHeader>
              </Card>

              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 scrollbar-hide">
                <CollapsibleSection
                  id="reframe"
                  icon={Lightbulb}
                  title="Reframe Strategy"
                  content={analysis.reframes[0]}
                  badge="Say This First"
                  accentColor="primary"
                />

                <CollapsibleSection
                  id="question"
                  icon={Target}
                  title="Power Question"
                  content={analysis.powerQuestion}
                  badge="Pivot"
                  accentColor="purple"
                />

                <CollapsibleSection
                  id="close"
                  icon={TrendingUp}
                  title="The Close"
                  content={analysis.closingTactic}
                  accentColor="emerald"
                />

                {analysis.story && (
                  <CollapsibleSection
                    id="story"
                    icon={BookOpen}
                    title="Analogy / Story"
                    content={analysis.story}
                    badge="Persuasion"
                    accentColor="orange"
                  />
                )}

                {analysis.identityUpgrade && (
                  <CollapsibleSection
                    id="identity"
                    icon={Shield}
                    title="Identity Appeal"
                    content={analysis.identityUpgrade}
                    badge="Psychology"
                    accentColor="blue"
                  />
                )}

                {analysis.competitorAngle && (
                  <CollapsibleSection
                    id="competitor"
                    icon={ArrowRight}
                    title="Competitor Kill Shot"
                    content={analysis.competitorAngle}
                    accentColor="primary"
                  />
                )}
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setProspectText("");
                  setAnalysis(null);
                }}
              >
                Reset Assistant
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center h-full min-h-[400px]"
            >
              <div className="text-center space-y-6 max-w-sm mx-auto p-6">
                <div className="h-24 w-24 rounded-full bg-muted/20 mx-auto flex items-center justify-center relative">
                  <div className="absolute inset-0 rounded-full border border-dashed border-muted-foreground/30 animate-[spin_10s_linear_infinite]" />
                  <Brain className="h-10 w-10 text-muted-foreground/50" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-foreground">Ready for Input</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    Paste any objection to see the "Closer Engine" in action.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground/60">
                  <div className="bg-muted/10 p-2 rounded">Price Objections</div>
                  <div className="bg-muted/10 p-2 rounded">Timing Delays</div>
                  <div className="bg-muted/10 p-2 rounded">Competitor Questions</div>
                  <div className="bg-muted/10 p-2 rounded">Trust Issues</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageWrapper>
  );
}
