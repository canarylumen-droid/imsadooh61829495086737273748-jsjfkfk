import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, X, ChevronDown, Sparkles, TrendingUp } from "lucide-react";

interface PDFChecklistItem {
  name: string;
  present: boolean;
  required: boolean;
}

interface PDFAnalysisResult {
  overall_score: number;
  clarity_score: number;
  detail_score: number;
  structure_score: number;
  missing_critical_score: number;
  items: PDFChecklistItem[];
  missing_critical: string[];
  recommendations: string[];
  file_warnings: string[];
  output_quality_level: number; // 1-5
  suggested_additions: string[];
  summary: string;
}

export function PDFUploadModalV2({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"gate" | "upload" | "analyzing" | "analysis" | "confirm">("gate");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<PDFAnalysisResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const { toast } = useToast();

  const handleGateNext = () => {
    setStep("upload");
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // File validation
    if (selectedFile.type !== "application/pdf") {
      toast({
        title: "❌ Wrong Format",
        description: "PDF files only. No images or Word docs.",
        variant: "destructive",
      });
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) {
      toast({
        title: "❌ File Too Large",
        description: "Keep it under 50MB. Yours is 100MB+. Try compressing.",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    setStep("analyzing");

    // Analyze
    try {
      const formData = new FormData();
      formData.append("pdf", selectedFile);

      // NOTE: Assuming 'token' is available in this scope, e.g., from a useAuth hook or context.
      // For demonstration, a placeholder is used. Replace with actual token retrieval.
      const response = await fetch("/api/brand-pdf/analyze", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (response.ok) {
        const result = await response.json();
        setAnalysis(result);
        setStep("analysis");
      } else {
        throw new Error("Analysis failed");
      }
    } catch (error) {
      console.error("Error analyzing PDF:", error);
      toast({
        title: "Analysis Error",
        description: "Try uploading a different file.",
        variant: "destructive",
      });
      setStep("upload");
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStep("confirm");
  };

  const handleConfirmUpload = async (forceContinue = false) => {
    if (!file) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("skipValidation", String(forceContinue));

      const response = await fetch("/api/brand-pdf/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        toast({
          title: "✅ Upload Complete",
          description: "Your brand is now live in the AI.",
        });
        onClose();
      } else {
        throw new Error("Upload failed");
      }
    } catch (error) {
      console.error("Error uploading PDF:", error);
      toast({
        title: "Upload Failed",
        description: "Try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  // ============ STEP 1: QUALITY GATE MODAL ============
  if (step === "gate") {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }}>
          <Card className="w-full max-w-md bg-gradient-to-b from-slate-800 to-slate-900 border-slate-700 shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <CardTitle className="text-lg">Upload Smarter, Get Better Results</CardTitle>
              </div>
              <CardDescription className="text-xs">Your AI closer needs your brand context. Help it sound like YOU.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                <p className="text-sm text-cyan-100 leading-relaxed">
                  Include: the problem you solve, your exact offer/pricing, target customer profile, your communication tone/style, and objections you handle often. More detail = smarter AI that sounds exactly like you.
                </p>
              </div>

              <div className="bg-blue-900/20 border border-blue-700/50 rounded p-3">
                <p className="text-xs text-blue-200">💡 Pro tip: Your AI will only be as good as the context you provide.</p>
              </div>

              <Button onClick={handleGateNext} className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
                Let&apos;s Go →
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ============ STEP 2: UPLOAD ============
  if (step === "upload" || step === "analyzing") {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Card className="w-full max-w-md bg-gradient-to-b from-slate-800 to-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle>Upload Your Brand PDF</CardTitle>
              <CardDescription>Supported: PDF only (under 50MB)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {step === "analyzing" && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity }}>
                    <Sparkles className="w-8 h-8 text-cyan-400" />
                  </motion.div>
                  <p className="text-sm text-gray-300">Analyzing your PDF...</p>
                </div>
              )}

              {step === "upload" && (
                <>
                  <label className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-slate-400 transition">
                    <input type="file" accept=".pdf" onChange={handleFileSelect} className="hidden" />
                    <p className="text-sm font-semibold text-white">Click to upload</p>
                    <p className="text-xs text-gray-400">or drag PDF here</p>
                  </label>

                  <Button variant="ghost" onClick={() => setStep("gate")} className="w-full text-gray-400">
                    ← Back
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ============ STEP 3: ANALYSIS RESULTS ============
  if (step === "analysis" && analysis) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-2xl">
          <Card className="bg-gradient-to-b from-slate-800 to-slate-900 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>AI Intake Analysis</CardTitle>
                  <CardDescription>Here&apos;s what we found in your PDF</CardDescription>
                </div>
                <button onClick={() => setStep("upload")} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Instant Summary */}
              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Summary</p>
                <p className="text-sm text-gray-200 mt-2">{analysis.summary}</p>
              </div>

              {/* Confidence Score - 4 Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <ScoreBox label="Clarity" score={analysis.clarity_score} />
                <ScoreBox label="Detail Level" score={analysis.detail_score} />
                <ScoreBox label="Structure" score={analysis.structure_score} />
                <ScoreBox label="Missing Info" score={analysis.missing_critical_score} />
              </div>

              {/* Overall Project Readiness */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Project Readiness</p>
                  <p className="text-lg font-bold text-cyan-400">{analysis.overall_score}%</p>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${analysis.overall_score}%` }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                  />
                </div>
              </div>

              {/* Output Quality Level */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-white">Expected Output Quality</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.1 }}
                      className={`flex-1 h-8 rounded flex items-center justify-center text-xs font-bold ${i <= analysis.output_quality_level
                        ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white"
                        : "bg-slate-700 text-gray-500"
                        }`}
                    >
                      ⭐
                    </motion.div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {analysis.output_quality_level === 5
                    ? "Professional level - AI will sound exactly like you"
                    : analysis.output_quality_level === 4
                      ? "High quality - strong output expected"
                      : analysis.output_quality_level === 3
                        ? "Good quality - decent results"
                        : "Moderate quality - add more details for better results"}
                </p>
              </div>

              {/* Checklist */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-white">Content Checklist</p>
                <div className="space-y-2">
                  {analysis.items.map((item, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-center gap-3 p-2 rounded bg-slate-700/30"
                    >
                      {item.present ? (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                        </motion.div>
                      ) : item.required ? (
                        <motion.div animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        </motion.div>
                      ) : (
                        <AlertCircle className="w-5 h-5 text-amber-400" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm text-gray-200">{item.name}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${item.present ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
                        {item.present ? "✓" : "✗"}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* File Warnings */}
              {analysis.file_warnings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-amber-300">⚠️ Heads Up</p>
                  {analysis.file_warnings.map((warning, idx) => (
                    <div key={idx} className="text-xs text-amber-200 bg-amber-900/20 border border-amber-700 rounded p-2">
                      {warning}
                    </div>
                  ))}
                </div>
              )}

              {/* Missing Critical */}
              {analysis.missing_critical.length > 0 && (
                <div className="bg-red-900/20 border border-red-700 rounded p-3 space-y-2">
                  <p className="text-sm font-semibold text-red-300">Missing Critical Info</p>
                  <ul className="text-xs text-red-200 space-y-1">
                    {analysis.missing_critical.map((item, idx) => (
                      <li key={idx}>• {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* AI Suggestions */}
              {analysis.suggested_additions.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    AI Recommends These Additions
                  </p>
                  <div className="space-y-2">
                    {analysis.suggested_additions.map((suggestion, idx) => (
                      <motion.button
                        key={idx}
                        onClick={() => {
                          setSelectedSuggestions(
                            selectedSuggestions.includes(suggestion)
                              ? selectedSuggestions.filter((s) => s !== suggestion)
                              : [...selectedSuggestions, suggestion]
                          );
                        }}
                        whileHover={{ scale: 1.02 }}
                        className={`w-full text-left p-3 rounded transition ${selectedSuggestions.includes(suggestion)
                          ? "bg-cyan-500/20 border border-cyan-500 text-cyan-200"
                          : "bg-slate-700/50 border border-slate-600 text-gray-300 hover:border-slate-500"
                          }`}
                      >
                        <p className="text-sm">{suggestion}</p>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-700">
                {analysis.overall_score < 60 ? (
                  <>
                    <Button
                      onClick={() => {
                        setFile(null);
                        setAnalysis(null);
                        setStep("upload");
                      }}
                      variant="outline"
                      className="flex-1"
                    >
                      Try Different PDF
                    </Button>
                    <motion.div
                      animate={{ x: [0, 5, 0] }}
                      transition={{ duration: 0.5, repeat: Infinity, delay: 1 }}
                      className="flex-1"
                    >
                      <Button
                        onClick={handleUpload}
                        className="w-full bg-cyan-500 hover:bg-cyan-600"
                        disabled={analysis.overall_score < 30}
                      >
                        Upload Anyway
                      </Button>
                    </motion.div>
                  </>
                ) : (
                  <Button onClick={handleUpload} className="w-full bg-green-500 hover:bg-green-600">
                    Ready To Upload →
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ============ STEP 4: CONFIRM (if low quality) ============
  if (step === "confirm" && analysis) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Card className="w-full max-w-md bg-gradient-to-b from-slate-800 to-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                Are You Sure?
              </CardTitle>
              <CardDescription>You&apos;re missing important info. Quality will suffer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-amber-900/20 border border-amber-700 rounded p-3">
                <p className="text-sm text-amber-200">
                  Missing: <strong>{analysis.missing_critical.join(", ")}</strong>
                </p>
                <p className="text-xs text-amber-300 mt-2">This will limit how good your AI sounds.</p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => setStep("analysis")}
                  variant="outline"
                  className="flex-1"
                >
                  Add More Info
                </Button>
                <motion.div animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1, repeat: Infinity }} className="flex-1">
                  <Button
                    onClick={() => handleConfirmUpload(true)}
                    disabled={uploading}
                    className="w-full bg-cyan-500 hover:bg-cyan-600"
                  >
                    {uploading ? "Uploading..." : "Upload Anyway"}
                  </Button>
                </motion.div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return null;
}

// ============ HELPER COMPONENT: SCORE BOX ============
function ScoreBox({ label, score }: { label: string; score: number }) {
  const getColor = (score: number) => {
    if (score >= 80) return "from-green-500 to-emerald-500";
    if (score >= 60) return "from-yellow-500 to-amber-500";
    return "from-red-500 to-orange-500";
  };

  return (
    <div className="bg-slate-700/50 border border-slate-600 rounded p-3">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={`text-2xl font-bold bg-gradient-to-r ${getColor(score)} bg-clip-text text-transparent`}>{score}</span>
        <span className="text-xs text-gray-500">%</span>
      </div>
    </div>
  );
}
