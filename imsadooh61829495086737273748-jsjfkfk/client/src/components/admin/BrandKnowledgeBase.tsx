/**
 * BrandKnowledgeBase — Full-featured PDF management UI
 * - Tab 1: View & edit extracted text inline (saves + re-indexes on save)
 * - Tab 2: Upload new PDF with drag-and-drop
 * - Tab 3: History of all uploaded PDFs
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Upload, History, FileText, Edit3, Save, X,
  Loader2, CheckCircle2, AlertCircle, RefreshCw, Sparkles,
  DatabaseZap, Layers, Target, ShieldAlert, Zap, Quote
} from "lucide-react";

interface PdfContent {
  exists: boolean;
  id: string;
  fileName: string;
  text: string;
  analysisScore: number;
  chunkCount: number;
  createdAt: string;
}

interface CachedPdf {
  id: string;
  fileName: string;
  fileSize: number;
  analysisScore: number;
  createdAt: string;
  updatedAt: string;
}

type Tab = "editor" | "upload" | "history" | "intelligence";

export function BrandKnowledgeBase({ onClose, embedded = false }: { onClose?: () => void, embedded?: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>("editor");
  const [content, setContent] = useState<PdfContent | null>(null);
  const [editedText, setEditedText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingIntelligence, setIsEditingIntelligence] = useState(false);
  const [editedUvp, setEditedUvp] = useState("");
  const [editedLogo, setEditedLogo] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [history, setHistory] = useState<CachedPdf[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<null | "analyzing" | "uploading" | "done">(null);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  // Load current PDF content
  const loadContent = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/brand-pdf/extracted-text", { credentials: "include" });
      const data = await res.json();
      setContent(data);
      if (data.text) setEditedText(data.text);
      if (data.intelligenceMetadata?.uvp) setEditedUvp(data.intelligenceMetadata.uvp);
      if (data.businessLogo) setEditedLogo(data.businessLogo);
    } catch (e) {
      console.error("Failed to load brand content:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/brand-pdf/cache", { credentials: "include" });
      const data = await res.json();
      setHistory(data.pdfs || []);
    } catch (e) {
      console.error("Failed to load PDF history:", e);
    }
  }, []);

  useEffect(() => {
    loadContent();
    loadHistory();
  }, [loadContent, loadHistory]);

  // Save edited text + re-index
  const handleSave = async () => {
    if (!content?.id) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/brand-pdf/extracted-text", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: editedText, pdfId: content.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: "✅ Saved & Re-indexed",
          description: `${data.chunksIndexed} semantic chunks updated in the vector store.`,
        });
        setIsEditing(false);
        await loadContent();
      } else {
        throw new Error(data.error || "Save failed");
      }
    } catch (e: any) {
      toast({ title: "Save Failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // Save edited intelligence
  const handleSaveIntelligence = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/brand-pdf/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ uvp: editedUvp, businessLogo: editedLogo }), 
      });
      
      const data = await res.json();
      if (data.success) {
        toast({ title: "✅ Intelligence Updated", description: "Strategic vectors realigned." });
        setIsEditingIntelligence(false);
        await loadContent();
      } else {
        throw new Error(data.error || "Save failed");
      }
    } catch (e: any) {
      toast({ title: "Save Failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // Upload + analyze + index
  const handleUpload = async (file: File) => {
    if (!file || file.type !== "application/pdf") {
      toast({ title: "PDFs Only", description: "Please select a .pdf file.", variant: "destructive" });
      return;
    }

    setUploadProgress("analyzing");
    try {
      const formData = new FormData();
      formData.append("pdf", file);

      // Step 1: Analyze
      const analyzeRes = await fetch("/api/brand-pdf/analyze", { method: "POST", body: formData, credentials: "include" });
      if (!analyzeRes.ok) throw new Error("Analysis failed");

      setUploadProgress("uploading");

      // Step 2: Upload + index
      const uploadForm = new FormData();
      uploadForm.append("pdf", file);
      const uploadRes = await fetch("/api/brand-pdf/upload", {
        method: "POST",
        body: uploadForm,
        credentials: "include",
      });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed (${uploadRes.status})`);
      }

      const result = await uploadRes.json();
      setUploadResult(result);
      setUploadProgress("done");

      toast({
        title: "🧠 Brand PDF Indexed!",
        description: `${result.chunksIndexed || 0} semantic chunks ready for AI retrieval.`,
      });

      await loadContent();
      await loadHistory();
      setTimeout(() => setActiveTab("editor"), 1500);
    } catch (e: any) {
      toast({ title: "Upload Failed", description: e.message, variant: "destructive" });
      setUploadProgress(null);
    }
  };

  // Drag + drop handlers
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }, []);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "editor", label: "Knowledge Editor", icon: <Edit3 className="w-4 h-4" /> },
    { id: "intelligence", label: "Intelligence Memo", icon: <Target className="w-4 h-4" /> },
    { id: "upload", label: "Upload PDF", icon: <Upload className="w-4 h-4" /> },
    { id: "history", label: "History", icon: <History className="w-4 h-4" /> },
  ];

  const MainContent = (
    <Card className={`flex flex-col h-full ${embedded ? "border-0 shadow-none bg-transparent" : "bg-gradient-to-b from-slate-900 to-slate-950 border-slate-700 shadow-2xl"} overflow-hidden`}>
          {/* Header */}
          <CardHeader className="border-b border-slate-700/60 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-transparent pb-0 pt-5 px-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-white text-lg">Brand Knowledge Base</CardTitle>
                  <CardDescription className="text-slate-400 text-xs">
                    Your AI reads this to sound exactly like you
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {content?.exists && (
                  <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-xs gap-1">
                    <DatabaseZap className="w-3 h-3" />
                    {content.chunkCount} chunks indexed
                  </Badge>
                )}
                {onClose && (
                  <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 hover:text-white h-8 w-8">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-all relative ${
                    activeTab === tab.id
                      ? "bg-slate-800 text-white border-t border-x border-slate-600 shadow-[0_-4px_12px_-4px_rgba(6,182,212,0.2)]"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.id === 'intelligence' && (content as any)?.intelligenceMetadata?.lastResearchAt && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                       <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                       <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </CardHeader>

          {/* Content */}
          <CardContent className="flex-1 overflow-hidden p-0">
            <AnimatePresence mode="wait">

              {/* ── TAB 0: INTELLIGENCE ── */}
              {activeTab === "intelligence" && (
                <motion.div
                  key="intelligence"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="h-full flex flex-col p-6 overflow-y-auto space-y-6"
                >
                  {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                       <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center bg-slate-800/20 p-4 rounded-2xl border border-slate-700/50">
                         <div className="flex items-center gap-3">
                           {((content as any)?.businessLogo || editedLogo) ? (
                             <img src={(content as any)?.businessLogo || editedLogo} alt="Brand Logo" className="w-10 h-10 rounded-lg object-cover" />
                           ) : (
                             <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500">Logo</div>
                           )}
                           <div>
                             <h3 className="text-white text-sm font-semibold">Brand Identity</h3>
                             <p className="text-slate-400 text-xs">Visually steer the generated assets</p>
                           </div>
                         </div>
                         {isEditingIntelligence ? (
                           <div className="flex gap-2 items-center">
                              <input 
                                type="text"
                                placeholder="Logo Image URL..."
                                value={editedLogo}
                                onChange={e => setEditedLogo(e.target.value)}
                                className="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                              />
                             <Button size="sm" onClick={handleSaveIntelligence} className="h-8 gap-1" disabled={isSaving}>
                               {isSaving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Save className="w-3 h-3" />} Save Look
                             </Button>
                           </div>
                         ) : (
                           <Button size="sm" variant="outline" onClick={() => setIsEditingIntelligence(true)} className="h-8 border-slate-600 text-slate-300">
                             <Edit3 className="w-3 h-3 mr-1" /> Edit Brand
                           </Button>
                         )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Competitive Gaps */}
                        <div className="p-5 rounded-2xl bg-slate-800/20 border border-slate-700/50 hover:border-rose-500/30 transition-colors group">
                           <div className="flex items-center gap-3 mb-4">
                             <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 group-hover:bg-rose-500/20 transition-colors">
                               <ShieldAlert className="w-4 h-4" />
                             </div>
                             <h4 className="text-white text-sm font-bold uppercase tracking-wider">Competitor Gaps</h4>
                           </div>
                           <ul className="space-y-3">
                             {((content as any)?.intelligenceMetadata?.marketGaps || ["No gaps identified yet."]).map((gap: string, i: number) => (
                               <li key={i} className="text-slate-300 text-xs flex gap-2 items-start leading-relaxed">
                                 <span className="text-rose-500 mt-1 shrink-0">•</span> {gap}
                               </li>
                             ))}
                           </ul>
                        </div>

                        {/* UVP & Differentiators */}
                        <div className="p-5 rounded-2xl bg-slate-800/20 border border-slate-700/50 hover:border-cyan-500/30 transition-colors group">
                           <div className="flex items-center gap-3 mb-4">
                             <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20 transition-colors">
                               <Zap className="w-4 h-4" />
                             </div>
                             <h4 className="text-white text-sm font-bold uppercase tracking-wider">Strategic Position</h4>
                           </div>
                           <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/20 mb-5 relative overflow-hidden">
                              <Quote className="absolute -right-2 -bottom-2 w-12 h-12 text-cyan-500/10 -rotate-12" />
                              {isEditingIntelligence ? (
                                <textarea 
                                  value={editedUvp}
                                  onChange={e => setEditedUvp(e.target.value)}
                                  className="w-full bg-slate-900 border border-cyan-500/50 rounded p-2 text-cyan-100 text-xs relative z-10 resize-none h-20 outline-none"
                                />
                              ) : (
                                <p className="text-cyan-100 text-xs italic font-medium relative z-10 transition-colors">
                                  "{(content as any)?.intelligenceMetadata?.uvp || "Analyzing your documentation for a unique edge..."}"
                                </p>
                              )}
                           </div>
                           <div className="space-y-2">
                              <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest pl-1">Differentiators</p>
                              <div className="flex flex-wrap gap-1.5">
                                {((content as any)?.intelligenceMetadata?.differentiators || []).map((d: string, i: number) => (
                                  <Badge key={i} variant="outline" className="border-cyan-500/20 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 text-[10px] transition-colors">
                                    {d}
                                  </Badge>
                                ))}
                                {((content as any)?.intelligenceMetadata?.differentiators || []).length === 0 && (
                                  <span className="text-slate-600 text-[10px] italic pl-1">Awaiting deep research...</span>
                                )}
                              </div>
                           </div>
                        </div>
                      </div>

                      {/* Why We Win Section */}
                      <div className="relative p-7 rounded-3xl bg-gradient-to-br from-purple-600/10 via-slate-800/40 to-transparent border border-purple-500/20 shadow-inner group">
                        <div className="absolute top-6 right-8 text-purple-500/10 transition-transform group-hover:scale-110 duration-500">
                          <Target className="w-20 h-20" />
                        </div>
                        <div className="relative z-10">
                          <h4 className="text-purple-300 text-xs font-black uppercase mb-3 flex items-center gap-2 tracking-widest">
                            <Sparkles className="w-3 h-3 animate-pulse" />
                            Elite Winning Framework
                          </h4>
                          <p className="text-slate-200 text-[13px] leading-relaxed max-w-2xl font-light">
                            {(content as any)?.intelligenceMetadata?.whyYouWin || "Your brand intelligence is currently under analysis by the Level 10 engine. This strategy will allow the AI to reach beyond generic features and hit the emotional triggers that drive high-ticket sales."}
                          </p>
                        </div>
                      </div>

                      {/* Rivals Table Preview */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-4 px-1">
                          <h4 className="text-slate-500 text-[10px] uppercase font-black tracking-widest">Competitor Landscape</h4>
                          {(content as any)?.intelligenceMetadata?.lastResearchAt && (
                            <span className="text-slate-600 text-[9px]">Last Research: {new Date((content as any).intelligenceMetadata.lastResearchAt).toLocaleDateString()}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {((content as any)?.intelligenceMetadata?.competitors || []).map((c: string, i: number) => (
                            <div key={i} className="px-4 py-2 rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-[11px] hover:border-slate-600 transition-colors cursor-default">
                              {c}
                            </div>
                          ))}
                          {((content as any)?.intelligenceMetadata?.competitors || []).length === 0 && (
                            <p className="text-slate-600 text-[10px] italic pl-1">No major rivals identified yet.</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </motion.div>
              )}

              {/* ── TAB 1: EDITOR ── */}
              {activeTab === "editor" && (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col p-6 gap-4"
                >
                  {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                    </div>
                  ) : !content?.exists ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                      <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
                        <FileText className="w-8 h-8 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-white font-semibold">No Brand PDF uploaded yet</p>
                        <p className="text-slate-400 text-sm mt-1">
                          Upload your brand document to train your AI closer.
                        </p>
                      </div>
                      <Button
                        onClick={() => setActiveTab("upload")}
                        className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Upload Brand PDF
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Metadata strip */}
                      <div className="flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-300 font-medium">{content.fileName}</span>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                            Score: {content.analysisScore}%
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { setIsEditing(false); setEditedText(content.text); }}
                                className="text-slate-400 h-8"
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={handleSave}
                                disabled={isSaving}
                                className="bg-cyan-500 hover:bg-cyan-600 text-black h-8 gap-1.5"
                              >
                                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                {isSaving ? "Saving..." : "Save & Re-index"}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={loadContent}
                                className="text-slate-400 h-8 gap-1.5"
                              >
                                <RefreshCw className="w-3 h-3" />
                                Refresh
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => { setIsEditing(true); setTimeout(() => textareaRef.current?.focus(), 50); }}
                                className="bg-purple-600 hover:bg-purple-700 h-8 gap-1.5"
                              >
                                <Edit3 className="w-3 h-3" />
                                Edit Content
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Text area */}
                      <div className="flex-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
                        <textarea
                          ref={textareaRef}
                          value={editedText}
                          onChange={e => setEditedText(e.target.value)}
                          readOnly={!isEditing}
                          className={`w-full h-full p-4 text-sm text-slate-200 bg-transparent resize-none outline-none font-mono leading-relaxed scrollbar-thin scrollbar-thumb-slate-700 ${
                            isEditing
                              ? "border-cyan-500/50 ring-1 ring-cyan-500/30"
                              : "cursor-default text-slate-300"
                          }`}
                          placeholder="Your brand content will appear here..."
                          spellCheck={isEditing}
                        />
                      </div>

                      {isEditing && (
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-xs text-cyan-400/70 flex items-center gap-1.5 shrink-0"
                        >
                          <Sparkles className="w-3 h-3" />
                          Edits are re-indexed into the vector store automatically on save
                        </motion.p>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {/* ── TAB 2: UPLOAD ── */}
              {activeTab === "upload" && (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center p-8 gap-6"
                >
                  {uploadProgress === "done" ? (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="flex flex-col items-center gap-4 text-center"
                    >
                      <CheckCircle2 className="w-16 h-16 text-green-400" />
                      <p className="text-white text-xl font-bold">Successfully Indexed!</p>
                      <p className="text-slate-400 text-sm">
                        {uploadResult?.chunksIndexed || 0} semantic chunks are now in your AI's memory.
                      </p>
                      <Button onClick={() => { setUploadProgress(null); setActiveTab("editor"); }} className="bg-cyan-500 hover:bg-cyan-600 text-black">
                        View Knowledge Base →
                      </Button>
                    </motion.div>
                  ) : uploadProgress === "analyzing" || uploadProgress === "uploading" ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center gap-5"
                    >
                      <div className="relative">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          className="w-16 h-16 rounded-full border-4 border-cyan-500/30 border-t-cyan-500"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          {uploadProgress === "analyzing" ? (
                            <Brain className="w-6 h-6 text-cyan-400" />
                          ) : (
                            <Layers className="w-6 h-6 text-purple-400" />
                          )}
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-white font-semibold text-lg">
                          {uploadProgress === "analyzing" ? "Analyzing PDF..." : "Indexing into Vector Store..."}
                        </p>
                        <p className="text-slate-400 text-sm mt-1">
                          {uploadProgress === "analyzing"
                            ? "Extracting brand context and scoring quality"
                            : "Chunking text and generating semantic embeddings"}
                        </p>
                      </div>
                      {/* Animated progress bar */}
                      <div className="w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          animate={{ x: ["-100%", "200%"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                          className="w-1/2 h-full bg-gradient-to-r from-transparent via-cyan-500 to-transparent"
                        />
                      </div>
                    </motion.div>
                  ) : (
                    <>
                      {/* Tip banner */}
                      <div className="w-full max-w-xl bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4">
                        <p className="text-cyan-200 text-sm leading-relaxed">
                          <strong>What to include:</strong> Your offer, pricing, target customer, communication style,
                          success stories, and common objections. The more detail, the smarter your AI.
                        </p>
                      </div>

                      {/* Drop zone */}
                      <div
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        className={`w-full max-w-xl h-48 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 transition-all cursor-pointer ${
                          isDragging
                            ? "border-cyan-400 bg-cyan-500/10 scale-[1.02]"
                            : "border-slate-600 hover:border-slate-400 bg-slate-800/40"
                        }`}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <motion.div
                          animate={isDragging ? { scale: [1, 1.1, 1] } : {}}
                          transition={{ duration: 0.5, repeat: Infinity }}
                        >
                          <Upload className={`w-10 h-10 ${isDragging ? "text-cyan-400" : "text-slate-500"}`} />
                        </motion.div>
                        <div className="text-center">
                          <p className="text-white font-semibold">
                            {isDragging ? "Drop it!" : "Drag & drop your PDF here"}
                          </p>
                          <p className="text-slate-400 text-sm">or click to browse • PDF only • Max 10MB</p>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                        />
                      </div>

                      {content?.exists && (
                        <p className="text-slate-500 text-xs">
                          A PDF is already indexed. Uploading a new one will replace the current knowledge base.
                        </p>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {/* ── TAB 3: HISTORY ── */}
              {activeTab === "history" && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full overflow-y-auto p-6"
                >
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                      <History className="w-10 h-10 text-slate-600" />
                      <p className="text-slate-400 text-sm">No upload history yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {history.map((pdf, i) => (
                        <motion.div
                          key={pdf.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center gap-4 p-4 bg-slate-800/60 border border-slate-700 rounded-xl hover:border-slate-500 transition-colors"
                        >
                          <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                            <FileText className="w-5 h-5 text-slate-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{pdf.fileName}</p>
                            <p className="text-slate-500 text-xs">
                              {new Date(pdf.createdAt).toLocaleDateString()} •{" "}
                              {(pdf.fileSize / 1024).toFixed(0)}KB
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                              pdf.analysisScore >= 70
                                ? "bg-green-500/20 text-green-300"
                                : pdf.analysisScore >= 40
                                ? "bg-yellow-500/20 text-yellow-300"
                                : "bg-red-500/20 text-red-300"
                            }`}>
                              {pdf.analysisScore >= 70 ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <AlertCircle className="w-3 h-3" />
                              )}
                              {pdf.analysisScore}%
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

            </AnimatePresence>
          </CardContent>
    </Card>
  );

  if (embedded) {
    return <div className="h-full min-h-[500px]">{MainContent}</div>;
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-4xl h-[85vh] flex flex-col"
      >
        {MainContent}
      </motion.div>
    </div>
  );
}

export default BrandKnowledgeBase;
