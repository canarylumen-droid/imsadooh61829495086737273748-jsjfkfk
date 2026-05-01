import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Send, Wand2, Mail, Clock, Users, Smartphone, Monitor,
  Upload, CheckCircle2, ChevronRight, ChevronLeft, Sparkles,
  FileText, Plus, Database, Inbox, Tags
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CsvIcon, PdfIcon } from "@/components/ui/CustomIcons";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "framer-motion";
import { useUser } from "@/hooks/use-user";

interface UnifiedCampaignWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialLeads?: any[];
}

// Default tags if no leads are present
const DEFAULT_PERSONALIZATION_TAGS = [
  { label: "First Name", value: "{{firstName}}" },
  { label: "Last Name", value: "{{lastName}}" },
  { label: "Company", value: "{{company}}" },
  { label: "City", value: "{{city}}" },
  { label: "Industry", value: "{{industry}}" },
  { label: "Niche", value: "{{niche}}" },
  { label: "Website", value: "{{website}}" },
];

export default function UnifiedCampaignWizard({ isOpen, onClose, onSuccess, initialLeads = [] }: UnifiedCampaignWizardProps) {
  const { toast } = useToast();
  const { data: user } = useUser();
  const userId = user?.id;
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"ios" | "android">("ios");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [cleanMode, setCleanMode] = useState(false);

  // State Management
  const [sourceType, setSourceType] = useState<'upload' | 'database'>('upload');
  const [leads, setLeads] = useState<any[]>(initialLeads);
  const [importProgress, setImportProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [syncLimit, setSyncLimit] = useState<number | 'all'>(1000);

  const [mailboxLimits, setMailboxLimits] = useState<Record<string, number>>({});
  const [mailboxMaxMultipliers, setMailboxMaxMultipliers] = useState<Record<string, number>>({});

  const [campaignName, setCampaignName] = useState("");
  const [followUpDays, setFollowUpDays] = useState("3");
  const [targetDays, setTargetDays] = useState(10); // User-configurable target days
  const [excludeWeekends, setExcludeWeekends] = useState(false);
  const [aiAutonomousMode, setAiAutonomousMode] = useState(true);
  const [aiAdjustCopy, setAiAdjustCopy] = useState(false);
  const [selectedMailboxes, setSelectedMailboxes] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [followUpSubject, setFollowUpSubject] = useState("");
  const [followUpBody, setFollowUpBody] = useState("");
  const [followUpSubject2, setFollowUpSubject2] = useState("");
  const [followUpBody2, setFollowUpBody2] = useState("");
  const [autoReplyBody, setAutoReplyBody] = useState("");

  const { data: integrations = [] } = useQuery<any[]>({
    queryKey: ['/api/integrations'],
  });

  const availableMailboxes = (integrations || []).filter((i: any) =>
    ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected
  );

  useEffect(() => {
    if (availableMailboxes.length > 0) {
      const initialLimits: Record<string, number> = {};
      const initialMultipliers: Record<string, number> = {};
      availableMailboxes.forEach((mb: any) => {
        initialLimits[mb.id] = mb.metadata?.dailyLimit || 50;
        initialMultipliers[mb.id] = 3;
      });
      setMailboxLimits(initialLimits);
      setMailboxMaxMultipliers(initialMultipliers);
    }
  }, [availableMailboxes]);

  useEffect(() => {
    if (availableMailboxes.length > 0 && selectedMailboxes.length === 0) {
      setSelectedMailboxes([availableMailboxes[0].id]);
    }
  }, [availableMailboxes]);

  const totalDailyVolume = selectedMailboxes.reduce((sum, id) => sum + (mailboxLimits[id] || 0), 0);
  const maxTotalVolume = selectedMailboxes.reduce((sum, id) => sum + (mailboxLimits[id] || 0) * (mailboxMaxMultipliers[id] || 3), 0);

  // Weekend-aware velocity: if excluding weekends, only ~5/7 days are sending days
  const effectiveDailyMultiplier = excludeWeekends ? 5 / 7 : 1;
  const effectiveDailyVolume = totalDailyVolume * effectiveDailyMultiplier;
  const estimatedDays = leads.length > 0 && effectiveDailyVolume > 0 ? Math.ceil(leads.length / effectiveDailyVolume) : 0;
  const isExtendedTimeline = estimatedDays > targetDays;

  // How many more mailboxes (at 50/day each) to hit the target within targetDays
  const requiredDailyVolume = leads.length > 0 && targetDays > 0 ? Math.ceil(leads.length / (targetDays * effectiveDailyMultiplier)) : 0;
  const mailboxesNeeded = requiredDailyVolume > totalDailyVolume
    ? Math.ceil((requiredDailyVolume - totalDailyVolume) / 50)
    : 0;

  // Safety check: any mailbox sending > 200/day is a reputation risk
  const hasUnsafeMailbox = selectedMailboxes.some(id => (mailboxLimits[id] || 0) > 200);

  useEffect(() => {
    const saved = localStorage.getItem("campaign_draft");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.campaignName) setCampaignName(data.campaignName);
        if (data.subject) setSubject(data.subject);
        if (data.body) setBody(data.body);
        if (data.followUpSubject) setFollowUpSubject(data.followUpSubject);
        if (data.followUpBody) setFollowUpBody(data.followUpBody);
        if (data.followUpSubject2) setFollowUpSubject2(data.followUpSubject2);
        if (data.followUpBody2) setFollowUpBody2(data.followUpBody2);
        if (data.autoReplyBody) setAutoReplyBody(data.autoReplyBody);
        if (data.followUpDays) setFollowUpDays(data.followUpDays);
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const draft = { campaignName, subject, body, followUpSubject, followUpBody, followUpSubject2, followUpBody2, autoReplyBody, totalDailyVolume, followUpDays, targetDays, excludeWeekends };
      localStorage.setItem("campaign_draft", JSON.stringify(draft));
    }
  }, [campaignName, subject, body, followUpSubject, followUpBody, followUpSubject2, followUpBody2, autoReplyBody, totalDailyVolume, followUpDays, targetDays, excludeWeekends, isOpen]);

  const variants = {
    enter: (direction: number) => ({ x: direction > 0 ? 50 : -50, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({ x: direction < 0 ? 50 : -50, opacity: 0 })
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setImporting(true);
    setImportProgress(20);
    const formData = new FormData();
    const isPDF = selectedFile.name.toLowerCase().endsWith('.pdf');
    formData.append(isPDF ? 'pdf' : 'csv', selectedFile);

    try {
      const endpoint = isPDF ? '/api/leads/import-pdf' : '/api/leads/import-csv?preview=false';
      const res = await fetch(endpoint, { method: 'POST', body: formData, credentials: 'include' });
      if (!res.ok) throw new Error("Import failed");
      const data = await res.json();
      setLeads(data.leads || []);
      setImportProgress(100);
      toast({ title: "Import Successful", description: `Captured ${data.leadsImported || data.leads?.length} leads.` });
      setTimeout(() => setStep(2), 1000);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setTimeout(() => setImporting(false), 500);
    }
  };

  const handleFetchLeads = async () => {
    setIsLoadingLeads(true);
    try {
      const limitParam = syncLimit === 'all' ? 500000 : syncLimit;
      const res = await apiRequest("GET", `/api/leads?limit=${limitParam}&excludeActiveCampaignLeads=true`);
      const data = await res.json();
      if (data.leads) {
        setLeads(data.leads);
        toast({ title: "Leads Fetched", description: `Successfully loaded ${data.leads.length} leads.` });
      }
    } catch (err: any) {
      toast({ title: "Fetch failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoadingLeads(false);
    }
  };

  const handleLaunch = async () => {
    if (!campaignName) {
      toast({ title: "Name Required", description: "Please name your campaign before launching.", variant: "destructive" });
      return;
    }
    if (selectedMailboxes.length === 0) {
      toast({ title: "Mailbox Required", description: "Please select at least one connected mailbox.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/outreach/campaigns", {
        name: campaignName,
        leads: leads.map((l: any) => l.id || l),
        excludeWeekends,
        aiAutonomousMode,
        config: {
          dailyLimit: totalDailyVolume,
          mailboxLimits,
          mailboxMaxMultipliers,
          followUpDelayDays: parseInt(followUpDays),
          mailboxIds: selectedMailboxes,
          replyTo: replyTo || undefined,
          aiAdjustCopy
        },
        template: {
          subject, body, autoReplyBody,
          followups: [
            { delayDays: parseInt(followUpDays), subject: followUpSubject, body: followUpBody },
            { delayDays: parseInt(followUpDays) + 4, subject: followUpSubject2, body: followUpBody2 }
          ]
        }
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create campaign");
      }

      const campaign = await res.json();
      
      // Start the campaign immediately
      const startRes = await apiRequest("POST", `/api/outreach/campaigns/${campaign.id}/start`, {});
      if (!startRes.ok) {
        throw new Error("Campaign created but failed to start. Please check your inbox status.");
      }

      toast({ title: "Campaign Launched!", description: `${campaignName} has started successfully.` });
      localStorage.removeItem(`campaign_draft_${userId}`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast({ 
        title: "Launch failed", 
        description: err.message || "An unexpected error occurred.", 
        variant: "destructive" 
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Dynamic Tags from first lead's metadata
  const dynamicTags = leads[0]?.metadata ? 
    Object.keys(leads[0].metadata)
      .filter(k => !k.endsWith('_type') && k !== '_unmapped_cols')
      .map(k => ({ label: k.replace(/_/g, ' '), value: `{{${k}}}` })) : 
    [];

  const allTags = [...DEFAULT_PERSONALIZATION_TAGS, ...dynamicTags.filter(dt => !DEFAULT_PERSONALIZATION_TAGS.some(st => st.value === dt.value))];

  const handleGenerateSequence = async () => {
    setIsGeneratingAI(true);
    try {
      const res = await apiRequest("POST", "/api/outreach/generate-template", { focus: "high-conversion" });
      const { sequence } = await res.json();
      if (sequence) {
        setSubject(sequence.subject || "");
        setBody(sequence.body || "");
        setFollowUpSubject(sequence.followUpSubject || "");
        setFollowUpBody(sequence.followUpBody || "");
        setFollowUpSubject2(sequence.followUpSubject2 || "");
        setFollowUpBody2(sequence.followUpBody2 || "");
        setAutoReplyBody(sequence.autoReplyBody || "");
        toast({ title: "Sequence Generated!", description: "AI drafted your 3-step sequence." });
      }
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const insertTag = (tag: string, field: "subject" | "body" | "fs1" | "fb1" | "fs2" | "fb2" | "auto") => {
    switch (field) {
      case "subject": setSubject(prev => prev + tag); break;
      case "body": setBody(prev => prev + tag); break;
      case "fs1": setFollowUpSubject(prev => prev + tag); break;
      case "fb1": setFollowUpBody(prev => prev + tag); break;
      case "fs2": setFollowUpSubject2(prev => prev + tag); break;
      case "fb2": setFollowUpBody2(prev => prev + tag); break;
      case "auto": setAutoReplyBody(prev => prev + tag); break;
    }
  };

  const renderTagBar = (field: "subject" | "body" | "fs1" | "fb1" | "fs2" | "fb2" | "auto") => (
    <div className="flex flex-wrap gap-2 mb-3 items-center">
      <Tags className="w-3 h-3 text-muted-foreground mr-1" />
      {allTags.map(tag => (
        <button
          key={tag.value}
          onClick={() => insertTag(tag.value, field)}
          className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-primary/5 hover:bg-primary/15 border border-primary/10 text-primary transition-all active:scale-95"
        >
          {tag.label}
        </button>
      ))}
    </div>
  );

  const renderPreview = (subj: string, content: string) => {
    const sampleLead = leads[0] || { 
      name: "Prospect Name", 
      company: "Company Inc.",
      city: "San Francisco",
      industry: "SaaS",
      website: "example.com"
    };
    const firstName = sampleLead.name?.trim().split(' ')[0] || 'Prospect';
    const lastName = sampleLead.name?.trim().split(' ').slice(1).join(' ') || '';

    const process = (text: string) => {
      let processed = (text || "")
        .replace(/{{firstName}}/g, firstName)
        .replace(/{{lastName}}/g, lastName)
        .replace(/{{company}}/g, sampleLead.company || sampleLead.metadata?.company || 'Acme Corp')
        .replace(/{{city}}/g, sampleLead.city || sampleLead.metadata?.city || 'Remote')
        .replace(/{{industry}}/g, sampleLead.industry || sampleLead.metadata?.industry || 'Business')
        .replace(/{{niche}}/g, sampleLead.niche || sampleLead.metadata?.niche || 'Business')
        .replace(/{{website}}/g, sampleLead.website || sampleLead.metadata?.website || 'your site');

      // Process any other dynamic metadata tags
      if (sampleLead.metadata) {
        Object.entries(sampleLead.metadata).forEach(([key, val]) => {
          if (typeof val === 'string' && !key.endsWith('_type')) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            processed = processed.replace(regex, val);
          }
        });
      }
      return processed;
    };

    const filledSubject = process(subj);
    const filledBody = process(content);

    return (
      <div className="flex justify-center h-full items-center p-4 transform scale-[0.75] origin-center">
        <div className="relative bg-background border-[6px] border-gray-900 shadow-2xl w-[280px] h-[580px] rounded-[3rem] overflow-hidden">
          <div className="h-6 bg-background flex items-center justify-between px-6 pt-1">
            <span className="text-[10px] font-bold">9:41</span>
            <div className="w-3 h-2 bg-foreground rounded-[2px]" />
          </div>
          <div className="px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-2 mb-1">
              <Avatar className="w-6 h-6 rounded-full bg-primary/10">
                <AvatarFallback className="text-[10px] uppercase font-bold">{sampleLead.name?.[0]}</AvatarFallback>
              </Avatar>
              <div className="text-[10px] font-bold">{sampleLead.name}</div>
            </div>
            <div className="text-[11px] font-bold line-clamp-1">{filledSubject || "No Subject"}</div>
          </div>
          <ScrollArea className="h-[calc(100%-80px)] p-4 text-[12px] leading-relaxed italic whitespace-pre-wrap">{filledBody || "No message content..."}</ScrollArea>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-full sm:max-w-[95vw] w-full h-[100dvh] sm:h-[95vh] rounded-none sm:rounded-[2rem] p-0 overflow-hidden bg-background border-border/40 flex flex-col shadow-2xl">
        <div className="p-6 md:p-8 flex items-center justify-between border-b border-border/40 bg-card/50 backdrop-blur-xl shrink-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Send className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg md:text-2xl font-black italic tracking-tighter uppercase font-serif">Campaign Wizard</DialogTitle>
              <div className="flex gap-2 mt-1">
                {[1, 2].map(i => <div key={i} className={cn("h-1.5 rounded-full transition-all duration-500", step === i ? "w-8 bg-primary" : "w-2 bg-muted")} />)}
              </div>
            </div>
          </div>
          <DialogClose asChild><Button variant="ghost" size="icon" className="rounded-full"><Loader2 className="h-4 w-4 opacity-40" /></Button></DialogClose>
        </div>

        <div className="flex flex-1 overflow-hidden relative">
          <div className="flex-1 flex flex-col w-full relative">
            <div className="flex-1 overflow-y-auto w-full">
              <div className="max-w-4xl mx-auto p-6 md:p-10 pb-32">
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      <div className="space-y-8">
                        <div className="space-y-3">
                          <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Campaign Identity</Label>
                          <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g. Project Nova" className="h-14 bg-muted/20 border-0 font-bold text-lg rounded-2xl" />
                        </div>
                        <div className="space-y-4">
                          <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Connected Inboxes</Label>
                          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            {availableMailboxes.map(mb => {
                              const isSelected = selectedMailboxes.includes(mb.id);
                              return (
                                <div key={mb.id} onClick={() => isSelected ? setSelectedMailboxes(selectedMailboxes.filter(id => id !== mb.id)) : setSelectedMailboxes([...selectedMailboxes, mb.id])}
                                  className={cn("p-4 rounded-2xl border transition-all cursor-pointer", isSelected ? "border-primary bg-primary/5 shadow-sm" : "border-border/40 opacity-50")}>
                                  <div className="flex items-center justify-between mb-3 text-xs font-black italic">
                                    <div className="flex items-center gap-2">
                                      <Mail className="w-3 h-3" /> {mb.email}
                                    </div>
                                    {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                                  </div>
                                  {isSelected && (
                                    <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1">
                                      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
                                        <span className="opacity-40">Daily Sends</span>
                                        <span className="text-primary">{mailboxLimits[mb.id]}/day</span>
                                      </div>
                                      <Slider 
                                        value={[mailboxLimits[mb.id] || 30]} 
                                        onValueChange={v => setMailboxLimits(prev => ({ ...prev, [mb.id]: v[0] }))} 
                                        min={10} 
                                        max={mb.provider === 'smtp' ? 10000 : 2000} 
                                        step={10} 
                                      />
                                      <div className="p-3 bg-amber-500/5 rounded-xl border border-amber-500/10">
                                        <div className="flex justify-between text-[9px] font-black uppercase text-amber-600">
                                          <span>Safety Ceiling</span>
                                          <span>{mb.provider === 'smtp' ? 10000 : 2000}/day</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-8">
                        <div className="space-y-4">
                          <Label className="text-[10px] font-black uppercase tracking-widest opacity-40">Target Population</Label>
                          <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => setSourceType('database')} className={cn("p-4 rounded-2xl border-2 text-left transition-all", sourceType === 'database' ? "border-primary bg-primary/5 shadow-lg" : "border-border/40")}>
                              <Database className="w-5 h-5 mb-2 opacity-50" />
                              <p className="text-xs font-black uppercase">Existing</p>
                            </button>
                            <button onClick={() => setSourceType('upload')} className={cn("p-4 rounded-2xl border-2 text-left transition-all", sourceType === 'upload' ? "border-primary bg-primary/5 shadow-lg" : "border-border/40")}>
                              <Upload className="w-5 h-5 mb-2 opacity-50" />
                              <p className="text-xs font-black uppercase">Upload</p>
                            </button>
                          </div>
                          {sourceType === 'upload' ? (
                            <label className="border-2 border-dashed border-primary/20 hover:border-primary/40 p-8 rounded-2xl text-center cursor-pointer flex flex-col items-center gap-3 bg-primary/5 transition-all">
                              <input type="file" className="hidden" onChange={handleFileUpload} />
                              <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                              <div className="font-black uppercase text-[10px] tracking-widest italic">Drop CSV or PDF here</div>
                            </label>
                          ) : (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 relative">
                                  <Input 
                                    type={syncLimit === 'all' ? 'text' : 'number'}
                                    value={syncLimit === 'all' ? 'MAX (500k)' : syncLimit}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (val === '') {
                                        setSyncLimit(0);
                                      } else {
                                        const parsed = parseInt(val);
                                        if (!isNaN(parsed)) setSyncLimit(Math.max(0, Math.min(500000, parsed)));
                                      }
                                    }}
                                    disabled={syncLimit === 'all'}
                                    className="h-14 bg-muted/20 border-border/40 rounded-2xl pl-10 font-black"
                                  />
                                  <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
                                </div>
                                <Button 
                                  variant={syncLimit === 'all' ? 'default' : 'outline'}
                                  onClick={() => setSyncLimit(syncLimit === 'all' ? 1000 : 'all')}
                                  className="h-14 px-6 rounded-2xl font-black text-[10px] uppercase tracking-widest shrink-0"
                                >
                                  {syncLimit === 'all' ? 'Custom' : 'All Leads'}
                                </Button>
                              </div>
                              <Button 
                                onClick={handleFetchLeads} 
                                disabled={isLoadingLeads || (syncLimit !== 'all' && syncLimit <= 0)}
                                className="w-full h-14 rounded-2xl bg-primary/10 border-primary/20 text-primary text-xs font-black uppercase tracking-widest hover:bg-primary/20 flex gap-3 transition-all"
                              >
                                {isLoadingLeads ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                {syncLimit === 'all' ? 'Fetch Entire Workforce Pool' : `Sync ${syncLimit} Available Leads`}
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="p-8 bg-primary/5 rounded-[2.5rem] border border-primary/10 space-y-8">
                           <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2 text-primary">
                               <Sparkles className="w-5 h-5 animate-pulse" />
                               <span className="text-[10px] font-black uppercase tracking-widest">Growth Engine Plan</span>
                             </div>
                             <div className="flex items-center gap-2">
                               {hasUnsafeMailbox && (
                                 <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-[9px] font-black px-3 py-1">
                                   ⚠️ REPUTATION RISK
                                 </Badge>
                               )}
                               {totalDailyVolume > 0 && !hasUnsafeMailbox && (
                                 <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[9px] font-black px-3 py-1">
                                   ✓ HEALTHY VELOCITY
                                 </Badge>
                               )}
                             </div>
                           </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                              <div>
                                <p className="text-[9px] uppercase font-black opacity-40 mb-1">Daily Capacity</p>
                                <p className={cn("text-3xl font-black italic transition-all", totalDailyVolume === 0 ? "text-muted-foreground/30" : "text-foreground")}>
                                  ~{totalDailyVolume}
                                </p>
                                <p className="text-[10px] opacity-40 italic">Total throughput</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase font-black opacity-40 mb-1">Per Mailbox</p>
                                <p className={cn("text-3xl font-black italic transition-all", totalDailyVolume === 0 ? "text-muted-foreground/30" : "text-foreground")}>
                                  {selectedMailboxes.length > 0 ? Math.floor(totalDailyVolume / selectedMailboxes.length) : 0}
                                </p>
                                <p className="text-[10px] opacity-40 italic">Avg. daily limit</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase font-black opacity-40 text-amber-600 mb-1 flex items-center gap-1">
                                  Boost Buffer
                                </p>
                                <p className={cn("text-3xl font-black italic transition-all", totalDailyVolume === 0 ? "text-amber-600/30" : "text-amber-600")}>
                                  +{maxTotalVolume - totalDailyVolume}
                                </p>
                                <p className="text-[10px] text-amber-600/40 italic">AI adaptive retry</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase font-black opacity-40 text-primary mb-1">
                                  {syncLimit === 'all' ? 'Workforce Velocity' : 'Campaign Velocity'}
                                </p>
                                <p className={cn("text-3xl font-black italic transition-all", totalDailyVolume === 0 ? "text-primary/30" : "text-primary")}>
                                  {estimatedDays}d
                                </p>
                                <p className="text-[10px] text-primary/40 italic">
                                  Time to finish {syncLimit === 'all' ? 'all' : leads.length} leads
                                </p>
                              </div>
                            </div>

                           {totalDailyVolume === 0 && (
                             <div className="p-4 bg-muted/20 border border-border/40 rounded-2xl text-[10px] font-bold italic opacity-60">
                               ⚠️ No mailboxes selected. Please check at least one "Connected Inbox" above to calculate your growth plan.
                             </div>
                           )}

                          <div className="space-y-4 pt-4 border-t border-primary/5">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] font-black uppercase tracking-widest opacity-40 italic">Campaign Duration Goal: {targetDays} Days</Label>
                              <Badge className="bg-primary/10 text-primary text-[8px] font-black">{Math.round((totalDailyVolume * targetDays) / 1000)}k Target Volume</Badge>
                            </div>
                            <Slider value={[targetDays]} onValueChange={v => setTargetDays(v[0])} min={1} max={90} step={1} className="py-2" />
                            <p className="text-[10px] italic opacity-50">Set your ideal completion timeline. AI will warn you if daily limits exceed safety ceilings to reach this goal.</p>
                          </div>
                          
                          {(isExtendedTimeline || leads.length > 5000) && (
                            <div className={cn(
                              "p-5 rounded-3xl animate-in fade-in zoom-in-95 mt-4 transition-all",
                              isExtendedTimeline ? "bg-amber-500/5 border border-amber-500/20" : "bg-primary/5 border border-primary/10"
                            )}>
                              <div className="flex items-center gap-2 mb-2">
                                <Sparkles className={cn("w-4 h-4", isExtendedTimeline ? "text-amber-500" : "text-primary")} />
                                <span className={cn("text-[10px] font-black uppercase tracking-widest", isExtendedTimeline ? "text-amber-600" : "text-primary")}>
                                  {isExtendedTimeline ? "Timeline Optimization Required" : "High Volume Projection"}
                                </span>
                              </div>
                              <p className={cn("text-[11px] leading-relaxed font-bold", isExtendedTimeline ? "text-amber-700/80" : "text-foreground/70")}>
                                 {isExtendedTimeline ? (
                                   `Your ${leads.length.toLocaleString()} leads will complete in ~${estimatedDays} days at current velocity${excludeWeekends ? ' (weekends excluded)' : ''}. To hit your ${targetDays}-day goal, add ${mailboxesNeeded} more mailbox${mailboxesNeeded === 1 ? '' : 'es'} (~50/day each).`
                                 ) : (
                                   `Great! ${leads.length.toLocaleString()} leads across ${selectedMailboxes.length} mailbox${selectedMailboxes.length === 1 ? '' : 'es'} will finish in ~${estimatedDays} days — within your ${targetDays}-day target.${excludeWeekends ? ' (Weekends protected.)' : ''}`
                                 )}
                               </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {step === 2 && (
                    <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10">
                      <div className="flex items-center justify-between pb-6 border-b border-border/10">
                        <Label className="text-ms font-black uppercase tracking-[0.2em] opacity-40 italic">Sequence Designer (3-Steps)</Label>
                        <Button onClick={handleGenerateSequence} disabled={isGeneratingAI} className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground gap-3 font-black uppercase tracking-wider text-[10px] px-8 h-12 shadow-[0_0_30px_rgba(var(--primary),0.3)]">
                          {isGeneratingAI ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} AI Wizard Generate
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="p-6 bg-primary/5 rounded-3xl border border-primary/20 flex flex-col gap-4 col-span-1 md:col-span-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[11px] font-black uppercase text-primary">AI Autonomous Engine</p>
                              <p className="text-[10px] opacity-60 italic mt-1 max-w-lg">Allows the AI to automatically pause follow-ups, send invoices, and book Calendly meetings by reading Fathom call summaries and lead replies.</p>
                            </div>
                            <Switch checked={aiAutonomousMode} onCheckedChange={setAiAutonomousMode} className="scale-125 data-[state=checked]:bg-primary" />
                          </div>
                          
                          {aiAutonomousMode && (
                            <div className="flex items-center justify-between pt-4 border-t border-primary/10 animate-in fade-in slide-in-from-top-2">
                              <div>
                                <p className="text-[10px] font-black uppercase">Let AI Adjust Copy</p>
                                <p className="text-[9px] opacity-60 italic mt-1 font-bold text-primary">Per-lead dynamic rewriter. If a lead's reply contradicts your planned follow-up, AI will automatically rewrite the next message ONLY for that specific lead to maintain conversation flow.</p>
                              </div>
                              <Switch checked={aiAdjustCopy} onCheckedChange={setAiAdjustCopy} className="scale-110" />
                            </div>
                          )}
                        </div>
                        <div className="p-6 bg-muted/10 rounded-3xl border border-border/10 space-y-3">
                           <Label className="text-[9px] font-black uppercase opacity-40">Reply-To Routing</Label>
                           <Input value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="alias@domain.com" className="bg-background border-border/20 font-black text-xs h-12 rounded-xl" />
                        </div>
                        <div className="p-6 bg-muted/10 rounded-3xl border border-border/10 flex items-center justify-between">
                           <div>
                             <p className="text-[10px] font-black uppercase">Weekend Protection</p>
                             <p className="text-[9px] opacity-40 italic mt-1 text-emerald-600">Pauses sending on Saturdays/Sundays</p>
                           </div>
                           <Switch checked={excludeWeekends} onCheckedChange={setExcludeWeekends} className="scale-110" />
                        </div>
                      </div>

                      <Tabs defaultValue="S1" className="w-full">
                        <TabsList className="h-16 w-full bg-muted/20 p-2 rounded-2xl border border-border/10 mb-8 flex gap-3">
                          {['S1', 'S2', 'S3', 'Auto'].map(v => <TabsTrigger key={v} value={v} className="flex-1 rounded-xl text-[10px] font-black uppercase tracking-tighter data-[state=active]:bg-background data-[state=active]:shadow-xl transition-all h-full">{v}</TabsTrigger>)}
                        </TabsList>
                        <TabsContent value="S1" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                           <div className="space-y-2">
                             {renderTagBar("subject")}
                             <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="SUBJECT LINE" className="h-16 bg-muted/20 border-0 font-black text-xl rounded-2xl px-8" />
                           </div>
                           <div className="space-y-2">
                             {renderTagBar("body")}
                             <Textarea value={body} onChange={e => setBody(e.target.value)} className="min-h-[350px] bg-muted/5 border-0 rounded-2xl p-8 text-sm leading-relaxed resize-none font-serif italic" placeholder="CRAFT THE PERFECT PROPOSAL..." />
                           </div>
                        </TabsContent>
                        <TabsContent value="S2" className="space-y-6">
                           <div className="space-y-2">
                             {renderTagBar("fs1")}
                             <Input value={followUpSubject} onChange={e => setFollowUpSubject(e.target.value)} placeholder="S2 SUBJECT" className="h-16 bg-muted/20 border-0 font-black text-xl rounded-2xl px-8" />
                           </div>
                           <div className="space-y-2">
                             {renderTagBar("fb1")}
                             <Textarea value={followUpBody} onChange={e => setFollowUpBody(e.target.value)} className="min-h-[300px] bg-muted/5 border-0 rounded-2xl p-8 text-sm italic" placeholder="FIRST GENTLE PUSH..." />
                           </div>
                        </TabsContent>
                        <TabsContent value="S3" className="space-y-6">
                           <div className="space-y-2">
                             {renderTagBar("fs2")}
                             <Input value={followUpSubject2} onChange={e => setFollowUpSubject2(e.target.value)} placeholder="S3 SUBJECT" className="h-16 bg-muted/20 border-0 font-black text-xl rounded-2xl px-8" />
                           </div>
                           <div className="space-y-2">
                             {renderTagBar("fb2")}
                             <Textarea value={followUpBody2} onChange={e => setFollowUpBody2(e.target.value)} className="min-h-[300px] bg-muted/5 border-0 rounded-2xl p-8 text-sm italic" placeholder="FINAL ATTEMPT..." />
                           </div>
                        </TabsContent>
                        <TabsContent value="Auto" className="space-y-6">
                           <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl text-[10px] font-bold italic">Dynamic AI Responder: Sends within 3 minutes of any reply.</div>
                           <div className="space-y-2">
                             {renderTagBar("auto")}
                             <Textarea value={autoReplyBody} onChange={e => setAutoReplyBody(e.target.value)} className="min-h-[250px] bg-muted/5 border-0 rounded-2xl p-8 text-sm italic" placeholder="THANKS FOR REACHING OUT! WE'LL BE WITH YOU SOON..." />
                           </div>
                        </TabsContent>
                      </Tabs>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="p-6 md:p-10 border-t border-border/20 bg-card/95 backdrop-blur-2xl flex items-center justify-between shrink-0 sticky bottom-0 z-30 pb-16 md:pb-10">
              <Button variant="ghost" onClick={() => step > 1 ? setStep(step - 1) : onClose()} className="h-14 px-10 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-muted/50 transition-all font-sans">{step === 1 ? 'Discard' : 'Back'}</Button>
              {step < 2 ? (
                <Button 
                  disabled={leads.length === 0 || !campaignName || selectedMailboxes.length === 0 || isLoadingLeads} 
                  onClick={() => setStep(2)} 
                  className={cn(
                    "h-16 px-16 rounded-2xl font-black uppercase tracking-[0.2em] transition-all group font-sans flex flex-col items-center justify-center gap-0 relative overflow-hidden",
                    (leads.length === 0 || selectedMailboxes.length === 0 || isLoadingLeads) ? "bg-muted text-muted-foreground" : "shadow-2xl shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground"
                  )}
                >
                  {isLoadingLeads && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center backdrop-blur-sm">
                      <div className="h-5 w-5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-sm">
                    Design Outreach Sequence <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <span className="text-[8px] font-black opacity-50 tracking-widest mt-0.5">
                    {isLoadingLeads ? "SYNCING DATABASE..." : (leads.length === 0 ? "ADD LEADS TO CONTINUE" : (selectedMailboxes.length === 0 ? "SELECT AN INBOX TO CONTINUE" : "NEXT: CRAFT YOUR 3-STEP AI ENGINE"))}
                  </span>
                </Button>
              ) : (
                <Button onClick={handleLaunch} disabled={isLoading || !subject || !body} className="h-16 px-20 rounded-2xl font-black uppercase tracking-[0.3em] shadow-2xl shadow-emerald-500/20 bg-emerald-500 hover:bg-emerald-600 text-white text-sm gap-4 transition-all animate-pulse hover:animate-none font-sans relative">
                  {isLoading ? "LAUNCHING..." : "LAUNCH CAMPAIGN"} <Plus className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex-[0.7] relative overflow-hidden bg-gradient-to-br from-transparent to-primary/5 hidden lg:block border-l border-border/10">
            <div className="absolute top-10 left-1/2 -translate-x-1/2 w-full px-10 text-center">
               <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30 italic">Live Mobile Engagement Simulation</p>
            </div>
            {renderPreview(viewMode === 'edit' ? subject : (step === 2 ? subject : ""), viewMode === 'edit' ? body : (step === 2 ? body : ""))}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-4 bg-background/50 backdrop-blur-xl border border-border/20 p-2 rounded-full shadow-2xl scale-90">
               <Button onClick={() => setPreviewDevice('ios')} variant={previewDevice === 'ios' ? 'default' : 'ghost'} size="icon" className="rounded-full w-10 h-10"><Smartphone className="w-4 h-4" /></Button>
               <Button onClick={() => setPreviewDevice('android')} variant={previewDevice === 'android' ? 'default' : 'ghost'} size="icon" className="rounded-full w-10 h-10"><Monitor className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
