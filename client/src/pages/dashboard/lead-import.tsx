import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useMailbox } from "@/hooks/use-mailbox";
import { Upload, Loader2, CheckCircle2, Sparkles, Send, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { useRealtime } from "@/hooks/use-realtime";
import { PdfIcon, CsvIcon } from "@/components/ui/CustomIcons";
import { EmailPreview } from "@/components/dashboard/EmailPreview";
import { LeadsDisplayModal } from "@/components/dashboard/LeadsDisplayModal";
import UnifiedCampaignWizard from "@/components/outreach/UnifiedCampaignWizard";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

export default function LeadImportPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { selectedMailboxId } = useMailbox();
  const { socket } = useRealtime();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mPreviewOpen, setMPreviewOpen] = useState(false);
  const [mLeadsOpen, setMLeadsOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ subject: string; body: string }>({
    subject: "Intelligence Collaboration Proposal",
    body: "I saw your work in the industry..."
  });
  const [importing, setImporting] = useState(false);
  const [enableAi, setEnableAi] = useState(true);
  const [progress, setProgress] = useState(0);
  const [manualPasteText, setManualPasteText] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [importResults, setImportResults] = useState<{ imported: number; skipped: number; filtered?: number; leads?: any[] } | null>(null);
  const [isOutreachModalOpen, setIsOutreachModalOpen] = useState(false);
  const [leadStats, setLeadStats] = useState<{ total: number; planLimit: number } | null>(null);

  const refreshLeadStats = async () => {
    try {
      const res = await fetch('/api/leads?limit=1', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setLeadStats({ total: data.total || 0, planLimit: data.planLimit || 10000 });
      }
    } catch {}
  };

  // Fetch lead stats on mount
  useEffect(() => {
    refreshLeadStats();
  }, []);

  const handleManualImport = async () => {
    if (!manualPasteText.trim()) {
      toast({ title: "No text provided", description: "Please paste email content to extract leads.", variant: "destructive" });
      return;
    }

    setImporting(true);
    setProgress(20);

    try {
      // 1. Parse structured data from text
      setProgress(40);
      const parseRes = await fetch('/api/ai/parse-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: manualPasteText }),
        credentials: 'include'
      });

      if (!parseRes.ok) throw new Error("Failed to parse text");
      const { leads: extractedLeads } = await parseRes.json();
      setProgress(60);

      if (!extractedLeads || extractedLeads.length === 0) {
        toast({ title: "No leads found", description: "AI couldn't find any lead data in the pasted text.", variant: "destructive" });
        return;
      }

      // 2. Import into DB
      setProgress(80);
      const importRes = await apiRequest("POST", "/api/bulk/import-bulk", {
        leads: extractedLeads,
        aiPaused: !enableAi,
        integrationId: selectedMailboxId,
        distribute: !selectedMailboxId
      });

      const result = await importRes.json();
      setImportResults(result);
      setProgress(100);
      toast({ title: "Manual Import Success", description: `Imported ${result.imported} leads.` });
      refreshLeadStats();
    } catch (e: any) {
      toast({ title: "Manual import failed", description: e.message, variant: "destructive" });
    } finally {
      setTimeout(() => {
        setImporting(false);
        setProgress(0);
      }, 500);
    }
  };

  const handleOpenPreview = async () => {
    try {
      setImporting(true); // Reusing importing state for loading indicator
      const response = await fetch('/api/outreach/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: { name: "Sample Prospect", company: "Growth Corp", email: "target@prospect.com" }
        }),
        credentials: 'include'
      });

      const data = await response.json();
      if (data.success) {
        setPreviewData(data.preview);
        // Map dynamic lead data if available
        if (importResults?.leads?.[0]) {
          const lead = importResults.leads[0];
          const previewName = lead.name && lead.name !== 'Unknown' ? lead.name : 'there';
          setPreviewData(prev => ({
            ...prev,
            body: prev.body
              .replace(/\[Name\]/g, previewName)
              .replace(/\[Company\]/g, lead.company || "your team")
          }));
        }
        setMPreviewOpen(true);
      }
    } catch (e) {
      toast({ title: "Preview failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const processFileSelection = (selectedFile: File) => {
    const isPDF = selectedFile.name.toLowerCase().endsWith('.pdf');
    const isCSV = selectedFile.name.toLowerCase().endsWith('.csv');
    const isExcel = selectedFile.name.toLowerCase().match(/\.(xlsx|xls)$/i);

    if (!isPDF && !isCSV && !isExcel) {
      toast({
        title: "Invalid file type",
        description: "Please upload a CSV, Excel, or PDF file",
        variant: "destructive"
      });
      return;
    }

    setFile(selectedFile);
    setImportResults(null);
  };

  // Listen for socket progress
  useEffect(() => {
    if (!socket) return;

    const handleProgress = (payload: any) => {
      if (payload.type === 'bulk_import_progress') {
        const { current, total } = payload;
        const calcProgress = Math.round((current / total) * 100);
        setProgress(calcProgress);
      }
    };

    socket.on('leads_updated', handleProgress);
    return () => {
      socket.off('leads_updated', handleProgress);
    };
  }, [socket]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) processFileSelection(selectedFile);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const selectedFile = e.dataTransfer.files?.[0];
    if (selectedFile) processFileSelection(selectedFile);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setProgress(10);
    const formData = new FormData();

    const isPDF = file.name.toLowerCase().endsWith('.pdf');

    if (isPDF) {
      formData.append('pdf', file);
    } else {
      formData.append('csv', file);
    }

    // Pass the aiPaused flag (inverted trigger)
    formData.append('aiPaused', (!enableAi).toString());
    
    if (selectedMailboxId) {
      formData.append('integrationId', selectedMailboxId);
    }

    try {
      setProgress(30);
      // For CSV, we now use preview mode first
      const endpoint = isPDF ? '/api/leads/import-pdf' : '/api/leads/import-csv?preview=true';
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      setProgress(70);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Import failed');
      }

      const result = await response.json();
      setProgress(100);

      if (isPDF) {
        setImportResults({
          imported: result.leadsImported || 0,
          skipped: 0,
          leads: result.leads || []
        });
        toast({
          title: "PDF Processed",
          description: `Extracted ${result.leadsImported} leads. Reviewing...`
        });
      } else {
        // CSV Preview Mode
        if (result.preview) {
          if (!result.leads || result.leads.length === 0) {
            throw new Error("No valid leads found in CSV. Ensure at least one row has an email or name.");
          }
          setImportResults({
            imported: 0, // Not imported yet
            skipped: 0,
            leads: result.leads || [] // These are the preview leads
          });
          setMLeadsOpen(true); // Open modal for confirmation
          toast({
            title: "Data Synched",
            description: `${result.total} leads found. Reviewing intelligence core...`
          });
          setImporting(false); // Stop loading main spinner, modal takes over
          return;
        }

        // Fallback for direct import (shouldn't happen with new flow but safe to keep)
        setImportResults({
          imported: result.leadsImported || 0,
          skipped: result.errors?.length || 0,
          leads: result.leads || []
        });
      }

    } catch (error: any) {
      setProgress(0);
      toast({
        title: "Import failed",
        description: error.message || `Could not process ${isPDF ? 'PDF' : 'CSV'} file`,
        variant: "destructive"
      });
    } finally {
      // Ensure we stop loading state if we are NOT showing the modal
      // If result.preview is true, we keep loading (actually we stopped it inside the success block for preview)
      // But if error occurred, we MUST stop it.
      // The safest way is to check if we are still importing and not in preview mode success flow.
      // Actually, let's just use a timeout to clear it if it's still stuck, or better:
      if (isPDF) {
        setTimeout(() => {
          setImporting(false);
          setProgress(0);
        }, 2000);
      } else {
        // For CSV:
        // If success & preview -> we already setImporting(false) in the try block
        // If error -> we need to setImporting(false)
        // If success & no preview -> we need to setImporting(false) (though we handled that in try block too?)
        // Let's just enforce it here if it's still true and we didn't just open the modal?
        // Actually, if we just opened the modal, we set mLeadsOpen=true.
        if (!mLeadsOpen) {
          setImporting(false);
          setProgress(0);
        }
      }
    }
  };

  const handleFinalizeImport = async () => {
    if (!importResults?.leads || importResults.leads.length === 0) return;

    setImporting(true); // Reuse loading state provided to modal
    try {
      const response = await fetch('/api/bulk/import-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: importResults.leads.map(l => ({
            name: l.name,
            email: l.email,
            phone: l.phone,
            company: l.company,
            role: l.role,
            bio: l.bio,
            channel: l.channel,
            replyEmail: l.replyEmail,
            website: l.website,
            businessName: l.businessName,
            city: l.city,
            country: l.country,
            niche: l.niche,
            industry: l.industry,
            revenue: l.revenue,
            ...l.metadata
          })),
          channel: 'email',
          aiPaused: !enableAi,
          integrationId: selectedMailboxId,
          distribute: !selectedMailboxId
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to finalize import");
      }

      const result = await response.json();
      setProgress(100);

      setImportResults({
        imported: result.leadsImported || result.imported,
        skipped: result.leadsFiltered || result.skipped || 0,
        leads: result.leads || []
      });
      refreshLeadStats();
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });

      setMLeadsOpen(false); // Close modal on success
      setTimeout(() => {
        setFile(null);
        toast({
          title: "Network Synchronization Complete",
          description: `${result.leadsImported} items integrated. ${result.leadsFiltered || 0} duplicates protected.`
        });
      }, 2000);

    } catch (error: any) {
      toast({
        title: "Import Finalization Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <PageWrapper className="max-w-5xl mx-auto space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Lead Import
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload or paste leads for campaign targeting.
        </p>
      </div>

      {leadStats && (
        <Card className="border-border/40 shadow-sm bg-card">
          <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div>
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">Pipeline</p>
              <p className="text-base sm:text-lg font-bold tabular-nums">
                <span className="text-primary">{leadStats.total.toLocaleString()}</span> <span className="text-muted-foreground text-xs sm:text-sm font-medium">/ {leadStats.planLimit.toLocaleString()}</span>
              </p>
            </div>
            <div className="flex-1 w-full sm:max-w-xs">
              <div className="h-1.5 sm:h-2 bg-muted rounded-full overflow-hidden relative">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.max(0.5, Math.min(100, (leadStats.total / leadStats.planLimit) * 100))}%` }}
                />
              </div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground text-right mt-1">
                {leadStats.total > 0 && (leadStats.total / leadStats.planLimit) * 100 < 1
                  ? '<1% used'
                  : `${Math.round((leadStats.total / leadStats.planLimit) * 100)}% used`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/40 shadow-2xl relative overflow-hidden group bg-card">
        <CardHeader className="p-4 sm:p-8 pb-0 text-center relative z-10">
          <div className="inline-flex items-center justify-center p-3 sm:p-4 rounded-3xl bg-primary/10 mb-4 sm:mb-6">
            <Sparkles className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
          </div>
          <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight mb-2 text-foreground">
            Lead Intelligence Sync
          </CardTitle>
          <CardDescription className="text-[9px] sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            UPLOAD CSV, EXCEL, OR PDF FOR CAMPAIGN ANALYSIS
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 sm:p-8 space-y-6 sm:space-y-10 relative z-10">
          <div className="flex justify-center">
            <div className="bg-muted/10 p-1 rounded-2xl flex gap-1 border border-border/10">
              <Button
                variant={!pasteMode ? "default" : "ghost"}
                size="sm"
                onClick={() => { setPasteMode(false); setManualPasteText(""); }}
                className={cn(
                  "rounded-xl text-[9px] sm:text-[10px] font-bold h-8 sm:h-10 px-4 sm:px-6 transition-all",
                  !pasteMode ? "bg-primary shadow-lg text-primary-foreground" : "hover:bg-primary/10 text-muted-foreground"
                )}
              >
                FILE UPLOAD
              </Button>
              <Button
                variant={pasteMode ? "default" : "ghost"}
                size="sm"
                onClick={() => { setPasteMode(true); setFile(null); }}
                className={cn(
                  "rounded-xl text-[9px] sm:text-[10px] font-bold h-8 sm:h-10 px-4 sm:px-6 transition-all",
                  pasteMode ? "bg-primary shadow-lg text-primary-foreground" : "hover:bg-primary/10 text-muted-foreground"
                )}
              >
                PASTE TEXT
              </Button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 bg-muted/30 rounded-xl border border-border/50 gap-3">
            <div className="space-y-1">
              <Label className="text-xs sm:text-sm font-bold flex items-center gap-2">
                Enable AI Agent?
                <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1 py-0 h-3.5 sm:h-4 border-primary/20 text-primary uppercase tracking-widest">Recommended</Badge>
              </Label>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Automatically qualify and engage leads immediately after import.</p>
            </div>
            <div className="flex justify-start sm:justify-end">
              <Switch
                checked={enableAi}
                onCheckedChange={setEnableAi}
              />
            </div>
          </div>

          {pasteMode ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>Paste your leads data below (CSV, list, or raw text)</span>
              </div>
              <textarea
                value={manualPasteText}
                onChange={(e) => setManualPasteText(e.target.value)}
                placeholder={`John Doe, john@acme.com, 555-0100, Acme Corp\nJane Smith, jane@startup.io, 555-0200, Startup Inc\n-- or any format with names, emails, phones, companies`}
                className="w-full min-h-[200px] p-4 rounded-xl bg-muted/20 border border-border/40 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/30"
                disabled={importing}
              />
              <p className="text-[10px] text-muted-foreground/60">
                AI will automatically extract names, emails, phones, and companies from any format.
              </p>
            </div>
          ) : (
          <div
            className={cn(
              "border-2 border-dashed rounded-2xl p-6 sm:p-10 text-center transition-all cursor-pointer group/upload relative overflow-hidden",
              isDragging ? "bg-primary/20 border-primary scale-[1.02] shadow-[0_0_40px_rgba(0,180,255,0.3)]" : "border-border/40 hover:bg-primary/5 hover:border-primary/20",
              importing && "pointer-events-none opacity-50"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragging && (
              <div className="absolute inset-0 bg-primary/10 backdrop-blur-[2px] z-20 flex items-center justify-center animate-in fade-in duration-200">
                <div className="bg-primary/20 p-6 sm:p-8 rounded-full animate-bounce">
                  <Upload className="h-10 w-10 sm:h-12 sm:w-12 text-primary" />
                </div>
              </div>
            )}
            <Input
              type="file"
              accept=".csv,.xlsx,.xls,.pdf"
              onChange={handleFileUpload}
              disabled={importing}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer relative z-10 block w-full h-full">
              <div className="mb-4 sm:mb-6 flex justify-center">
                {file ? (
                  <div className="animate-in zoom-in duration-300">
                    {file.name.toLowerCase().endsWith('.pdf') ? <PdfIcon /> : <CsvIcon />}
                  </div>
                ) : (
                  <div className={cn(
                    "p-4 sm:p-5 rounded-2xl transition-all transform group-hover/upload:scale-110",
                    isDragging ? "bg-primary/20 scale-110" : "bg-primary/5 group-hover/upload:bg-primary/10"
                  )}>
                    <Upload className="h-8 w-8 sm:h-10 sm:w-10 text-primary" />
                  </div>
                )}
              </div>
              <p className="text-lg sm:text-xl font-bold tracking-tight mb-2">
                {file ? file.name : (isDragging ? 'Drop file to upload' : 'Select Data Source')}
              </p>
              <p className="text-[8px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/40">
                DRAG & DROP OR BROWSE • CSV, EXCEL, PDF
              </p>
            </label>
          </div>
          )}

          {importResults && (
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-muted/50 border border-border rounded-xl"
              >
                <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center shrink-0">
                  {file?.name.toLowerCase().endsWith('.pdf') ? <PdfIcon /> : <CsvIcon />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs sm:text-sm truncate">
                    {file?.name}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    {importResults.imported} entries imported • {importResults.skipped} duplicates
                  </p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 self-end sm:self-center" />
              </motion.div>

              <div className="p-3 sm:p-4 rounded-xl bg-primary/5 border border-primary/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 sm:mb-4">
                  <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider">Recently Uploaded</h3>
                  <div className="flex flex-wrap gap-2">
                    {importResults.leads && importResults.leads.length > 0 && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setMLeadsOpen(true)} className="text-[8px] sm:text-[10px] font-bold border-primary/20 hover:bg-primary/10 h-8">VIEW LEADS</Button>
                        <Button
                          size="sm"
                          onClick={() => setIsOutreachModalOpen(true)}
                          className="text-[8px] sm:text-[10px] font-bold bg-primary hover:bg-primary/90 gap-1 h-8"
                        >
                          <Send className="h-3 w-3" />
                          START OUTREACH
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setLocation('/dashboard/home')} className="text-[8px] sm:text-[10px] font-bold h-8">PIPELINE</Button>
                  </div>
                </div>
                <div className="space-y-1 sm:space-y-2">
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Your leads have been successfully synchronized to the pipeline.</p>
                </div>
              </div>
            </div>
          )}

          {importing && progress > 0 && (
            <div className="space-y-3">
              <Progress value={progress} className="h-1 sm:h-1.5" />
              <p className="text-[10px] sm:text-xs font-medium text-center text-muted-foreground">
                {progress < 30 ? 'Uploading file...' : progress < 70 ? 'Processing engagement data...' : 'Finalizing leads...'}
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center">
            <Button
              onClick={handleOpenPreview}
              variant="outline"
              disabled={importing}
              className="px-4 sm:px-6 rounded-xl text-xs font-semibold uppercase tracking-wider border-border/40 hover:bg-muted/30 h-10 sm:h-12 w-full sm:w-auto text-[10px] sm:text-xs"
            >
              Preview Outreach
            </Button>
            <Button
              onClick={pasteMode ? handleManualImport : handleImport}
              disabled={(pasteMode ? false : !file) || importing}
              className="flex-1 h-10 sm:h-12 rounded-xl text-xs font-semibold uppercase tracking-wider shadow-lg shadow-primary/10 bg-primary hover:bg-primary/90 transition-all min-w-0 text-[10px] sm:text-xs"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin flex-shrink-0" />
                  <span className="truncate">Synchronizing...</span>
                </>
              ) : (
                <span className="truncate">{pasteMode ? 'Extract Leads' : 'Start Import'}</span>
              )}
            </Button>
          </div>

          <EmailPreview
            isOpen={mPreviewOpen}
            onClose={() => setMPreviewOpen(false)}
            subject={previewData.subject}
            body={previewData.body}
          />

          <LeadsDisplayModal
            isOpen={mLeadsOpen}
            onClose={() => setMLeadsOpen(false)}
            leads={importResults?.leads || []}
            onConfirm={handleFinalizeImport}
            isImporting={importing}
            canConfirm={!importing}
          />

          <UnifiedCampaignWizard
            isOpen={isOutreachModalOpen}
            onClose={() => setIsOutreachModalOpen(false)}
            initialLeads={importResults?.leads || []}
            onSuccess={() => {
               toast({ title: "Outreach Started", description: "Emails will be sent according to your settings." });
            }}
          />

          {importResults && (importResults.filtered ?? 0) > 0 && (
            <div className="p-3 sm:p-4 rounded-xl bg-orange-400/5 border border-orange-400/10 flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <Sparkles className="h-3.5 w-3.5 text-orange-400" />
                <span className="text-[10px] sm:text-xs font-semibold text-orange-400/80 uppercase tracking-wider">Intelligence Filter Active</span>
              </div>
              <span className="text-[10px] sm:text-xs font-bold text-orange-400">{importResults.filtered} Leads Blocked</span>
            </div>
          )}

          {/* Subtle Glow */}
          <div className="absolute -bottom-10 -right-10 w-40 h-40 blur-[100px] opacity-10 bg-primary rounded-full group-hover:opacity-20 transition-opacity" />
        </CardContent>
      </Card>

      <ResponsiveGrid className="grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
        {[
          { label: 'CSV', desc: 'Standard contact export', icon: <CsvIcon /> },
          { label: 'Excel', desc: 'SaaS & CRM exports', icon: <CsvIcon /> },
          { label: 'PDF', desc: 'Reports and brand lists', icon: <PdfIcon /> },
        ].map((type, idx) => (
          <Card key={type.label} className={cn("p-4 sm:p-6 border-border/50 shadow-sm flex flex-col items-center text-center", idx === 2 && "col-span-2 md:col-span-1")}>
            <div className="mb-2 sm:mb-4">
              {type.icon}
            </div>
            <div className="font-bold text-base sm:text-lg mb-1">{type.label}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{type.desc}</p>
          </Card>
        ))}
      </ResponsiveGrid>

      <Card className="bg-primary/5 border-primary/20 rounded-2xl overflow-hidden relative">
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            <Badge variant="outline" className="mt-1 bg-primary text-primary-foreground border-0 font-semibold tracking-wider text-[10px] px-3 py-1">PRO TIP</Badge>
            <p className="text-sm text-balance leading-relaxed font-semibold tracking-tight text-foreground/80">
              Importing from Apollo, LinkedIn, or HubSpot? Our intelligent system automatically maps columns for instant outreach synchronization.
            </p>
          </div>
          <div className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 bg-primary rounded-full translate-x-10 -translate-y-10" />
        </CardContent>
      </Card>
    </PageWrapper>
  );
}
