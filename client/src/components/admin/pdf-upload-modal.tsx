import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Zap, Brain, Sparkles } from "lucide-react";

interface PDFChecklistItem {
  name: string;
  present: boolean;
  required: boolean;
}

interface PDFAnalysisResult {
  overall_score: number;
  items: PDFChecklistItem[];
  missing_critical: string[];
  recommendations: string[];
}

export function PDFUploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<PDFAnalysisResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append("pdf", selectedFile);

      const response = await fetch("/api/brand-pdf/analyze", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setAnalysis(result);
      } else {
        toast({
          title: "Error",
          description: "Failed to analyze PDF",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error analyzing PDF:", error);
      toast({
        title: "Error",
        description: "Failed to analyze PDF",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleUpload = async (forceContinue = false) => {
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
          title: "Success",
          description: "Brand PDF uploaded successfully",
        });
        onClose();
      } else {
        throw new Error("Upload failed");
      }
    } catch (error) {
      console.error("Error uploading PDF:", error);
      toast({
        title: "Error",
        description: "Failed to upload PDF",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  if (!file) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-md bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle>Upload Your Brand PDF</CardTitle>
            <CardDescription>
              Help your AI closer sound exactly like you
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
              <p className="text-sm text-cyan-100">
                Include: the problem you solve, your exact offer/pricing, target customer profile, your communication tone/style, and objections you handle often. More detail = smarter AI that sounds exactly like you.
              </p>
            </div>

            <div className="relative">
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
                id="pdf-input"
              />
              <label htmlFor="pdf-input">
                <Button
                  asChild
                  className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold cursor-pointer"
                >
                  <span>Select PDF</span>
                </Button>
              </label>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={onClose}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          <Card className="w-full bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 overflow-hidden">
            <CardContent className="pt-8 text-center space-y-6">
              {/* Animated AI brain */}
              <div className="flex justify-center gap-6 h-12">
                <motion.div
                  animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-cyan-400"
                >
                  <Brain className="w-8 h-8" />
                </motion.div>

                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="text-purple-400"
                >
                  <Zap className="w-8 h-8" />
                </motion.div>

                <motion.div
                  animate={{ rotate: [0, 360], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="text-yellow-400"
                >
                  <Sparkles className="w-8 h-8" />
                </motion.div>
              </div>

              {/* Main text */}
              <div className="space-y-2">
                <motion.p
                  animate={{ opacity: [0.8, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="text-white font-semibold text-lg"
                >
                  🧠 AI is analyzing...
                </motion.p>
                <motion.p
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-slate-300 text-sm"
                >
                  Extracting context • Understanding tone • Learning your brand
                </motion.p>
              </div>

              {/* Animated progress bar */}
              <div className="space-y-2">
                <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    animate={{
                      width: ['0%', '100%', '0%'],
                      backgroundPosition: ['0% center', '100% center', '0% center']
                    }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500"
                  />
                </div>
                <p className="text-xs text-slate-400">Analyzing quality...</p>
              </div>

              {/* Floating particles effect */}
              <div className="absolute inset-0 pointer-events-none">
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      x: [0, Math.random() * 100 - 50],
                      y: [0, Math.random() * 100 - 50],
                      opacity: [1, 0],
                    }}
                    transition={{
                      duration: 2 + i * 0.5,
                      repeat: Infinity,
                      delay: i * 0.3,
                    }}
                    className="absolute w-1 h-1 bg-cyan-400 rounded-full"
                    style={{
                      left: `${25 + i * 25}%`,
                      top: '50%',
                    }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (analysis) {
    const missingCount = analysis.missing_critical.length;
    const hasIssues = missingCount > 0;
    const extractedCount = analysis.items.filter(i => i.present).length;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-lg"
        >
          <Card className="w-full bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 max-h-[85vh] overflow-y-auto">
            <CardHeader className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span>📊 Brand PDF Analysis</span>
                  </CardTitle>
                  <CardDescription>What your AI will learn from this</CardDescription>
                </div>
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-3xl font-bold text-cyan-400"
                >
                  {analysis.overall_score}%
                </motion.div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Quality Score Progress Bar */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-300">BRAND PROFILE QUALITY</p>
                  <p className="text-xs text-gray-400">{extractedCount}/{analysis.items.length} items</p>
                </div>
                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${analysis.overall_score}%` }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    className="h-full bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400"
                  />
                </div>
              </motion.div>

              {/* What AI Learns Section */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3"
              >
                <p className="text-sm font-semibold text-cyan-300 mb-2">🧠 AI Will Learn:</p>
                <ul className="text-xs text-cyan-100 space-y-1">
                  {analysis.items.filter(i => i.present).map((item, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.1 }}
                    >
                      ✨ {item.name}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>

              {/* Content Found Checklist */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-2"
              >
                <p className="text-sm font-semibold text-white">📋 Content Analysis:</p>
                {analysis.items.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.08 }}
                    className="flex items-center gap-2 text-sm p-2 bg-slate-700/50 rounded"
                  >
                    {item.present ? (
                      <motion.span
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.6, repeat: Infinity }}
                        className="text-green-400 text-base"
                      >
                        ✅
                      </motion.span>
                    ) : (
                      <span className="text-red-400 text-base">❌</span>
                    )}
                    <span className={item.present ? "text-gray-300" : "text-gray-500"}>
                      {item.name}
                      {item.required && !item.present && " (required)"}
                    </span>
                  </motion.div>
                ))}
              </motion.div>

              {/* Missing Critical */}
              {hasIssues && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-red-500/10 border border-red-500/30 rounded-lg p-3"
                >
                  <p className="text-sm font-semibold text-red-300 mb-2">
                    ⚠️ Missing {missingCount} item{missingCount > 1 ? "s" : ""} to improve AI:
                  </p>
                  <ul className="text-xs text-red-200 space-y-1">
                    {analysis.missing_critical.map((item, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 + i * 0.1 }}
                      >
                        • {item}
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {/* Recommendations */}
              {analysis.recommendations.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3"
                >
                  <p className="text-sm font-semibold text-blue-300 mb-2">💡 How to improve:</p>
                  <ul className="text-xs text-blue-200 space-y-1">
                    {analysis.recommendations.map((rec, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.7 + i * 0.1 }}
                      >
                        • {rec}
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {/* Action Buttons */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="space-y-2 pt-4 border-t border-slate-700"
              >
                {hasIssues ? (
                  <>
                    <Button
                      className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                      onClick={() => {
                        setFile(null);
                        setAnalysis(null);
                      }}
                    >
                      ← Go Back & Improve
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleUpload(true)}
                      disabled={uploading}
                    >
                      {uploading ? "Uploading..." : "Upload Anyway"}
                    </Button>
                  </>
                ) : (
                  <motion.div
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Button
                      className="w-full bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white font-semibold"
                      onClick={() => handleUpload()}
                      disabled={uploading}
                    >
                      {uploading ? "Uploading..." : "✨ Upload & Train AI"}
                    </Button>
                  </motion.div>
                )}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={onClose}
                  disabled={uploading}
                >
                  Cancel
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return null;
}
