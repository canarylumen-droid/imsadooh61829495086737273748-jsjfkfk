import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Zap, Brain, Lightbulb, TrendingUp, MessageSquare, Target, Copy, Check, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ObjectionResponse {
  objection: string;
  category: string;
  reframes: string[];
  questions: string[];
  closingTactics: string[];
  nextStep: string;
}

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ description: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({ description: "Failed to copy", variant: "destructive" });
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded-md transition-all duration-200 hover:bg-white/10 ${className}`}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/50 hover:text-white/80" />
      )}
    </button>
  );
}

export function ObjectionsHandler() {
  const [prospectObjection, setProspectObjection] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("creator");
  const [response, setResponse] = useState<ObjectionResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const industries = [
    "creator",
    "agency",
    "founder",
    "retailer",
    "B2B",
    "coach",
    "all",
  ];

  const handleAnalyzeObjection = async () => {
    if (!prospectObjection.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/sales-engine/analyze-objection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objection: prospectObjection,
          industry: selectedIndustry,
        }),
        credentials: "include",
      });

      const data = await res.json();
      setResponse(data);
    } catch (error) {
      console.error("Error analyzing objection:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[600px]">
      {/* Left Panel - Input */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 backdrop-blur">
            <Brain className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">What did they say?</h2>
            <p className="text-sm text-white/50">Paste the objection below</p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <textarea
              value={prospectObjection}
              onChange={(e) => setProspectObjection(e.target.value)}
              placeholder={`"Let me think about it"\n"It's too expensive"\n"I need to talk to my partner"`}
              className="w-full h-32 backdrop-blur-sm bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all resize-none"
            />
          </div>

          <div>
            <p className="text-sm text-white/60 mb-3">Industry</p>
            <div className="flex flex-wrap gap-2">
              {industries.map((ind) => (
                <button
                  key={ind}
                  onClick={() => setSelectedIndustry(ind)}
                  className={`py-1.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 capitalize ${
                    selectedIndustry === ind
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80"
                  }`}
                >
                  {ind}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleAnalyzeObjection}
            disabled={!prospectObjection.trim() || loading}
            className="w-full h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg shadow-cyan-500/20 transition-all duration-200 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Get Response
              </>
            )}
          </Button>
        </div>

        {!response && !loading && (
          <div className="mt-8 p-4 rounded-xl bg-white/5 border border-white/10">
            <p className="text-sm text-white/60 flex items-start gap-2">
              <Lightbulb className="w-4 h-4 mt-0.5 text-amber-400 flex-shrink-0" />
              <span>Responses appear instantly. Copy them with one click to use during your call.</span>
            </p>
          </div>
        )}
      </div>

      {/* Right Panel - Response */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-2xl overflow-hidden">
        {loading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
              </div>
              <p className="text-white/60">Crafting your response...</p>
            </div>
          </div>
        )}

        {!response && !loading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-xs">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-white/10 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-white/30" />
              </div>
              <p className="text-white/40 text-sm">Your AI-crafted response will appear here</p>
            </div>
          </div>
        )}

        {response && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-4 h-full overflow-y-auto"
          >
            {/* Category Badge */}
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-cyan-400" />
              <span className="text-sm text-white/60">Detected:</span>
              <span className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 text-sm font-medium capitalize">
                {response.category}
              </span>
            </div>

            {/* Reframes */}
            <div className="backdrop-blur-sm bg-emerald-500/5 rounded-xl border border-emerald-500/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">Say This Instead</span>
              </div>
              <div className="space-y-2">
                {response.reframes.map((reframe, idx) => (
                  <div key={idx} className="group flex items-start gap-2 p-2.5 rounded-lg hover:bg-white/5 transition-colors">
                    <span className="text-white/80 text-sm flex-1">"{reframe}"</span>
                    <CopyButton text={reframe} className="opacity-0 group-hover:opacity-100" />
                  </div>
                ))}
              </div>
            </div>

            {/* Questions */}
            <div className="backdrop-blur-sm bg-purple-500/5 rounded-xl border border-purple-500/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-300">Questions to Ask</span>
              </div>
              <div className="space-y-2">
                {response.questions.map((question, idx) => (
                  <div key={idx} className="group flex items-start gap-2 p-2.5 rounded-lg hover:bg-white/5 transition-colors">
                    <span className="text-white/80 text-sm flex-1">"{question}"</span>
                    <CopyButton text={question} className="opacity-0 group-hover:opacity-100" />
                  </div>
                ))}
              </div>
            </div>

            {/* Closing Tactics */}
            <div className="backdrop-blur-sm bg-orange-500/5 rounded-xl border border-orange-500/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-medium text-orange-300">Close the Deal</span>
              </div>
              <div className="space-y-2">
                {response.closingTactics.map((tactic, idx) => (
                  <div key={idx} className="group flex items-start gap-2 p-2.5 rounded-lg hover:bg-white/5 transition-colors">
                    <span className="text-white/80 text-sm flex-1">{tactic}</span>
                    <CopyButton text={tactic} className="opacity-0 group-hover:opacity-100" />
                  </div>
                ))}
              </div>
            </div>

            {/* Next Step */}
            <div className="backdrop-blur-sm bg-cyan-500/5 rounded-xl border border-cyan-500/20 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-medium text-cyan-300">Next Step</span>
                </div>
                <CopyButton text={response.nextStep} />
              </div>
              <p className="text-white/80 text-sm mt-2">{response.nextStep}</p>
            </div>

            <Button
              onClick={() => {
                setProspectObjection("");
                setResponse(null);
              }}
              variant="ghost"
              className="w-full text-white/60 hover:text-white hover:bg-white/10 mt-2"
            >
              Clear & Try Another
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
