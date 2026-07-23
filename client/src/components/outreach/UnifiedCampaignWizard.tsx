import { useState, useEffect, useMemo } from "react";
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
  FileText, Plus, Database, Inbox, Tags, Trash2, X, AlertTriangle, Search, ArrowRight
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
import { getActivePlanId, getCampaignLimits } from "@shared/plan-utils";

interface UnifiedCampaignWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialLeads?: any[];
}

// Default tags if no leads are present
const DEFAULT_PERSONALIZATION_TAGS = [
  { label: "Sender Name", value: "{{sender_name}}" },
  { label: "First Name", value: "{{firstName}}" },
  { label: "Last Name", value: "{{lastName}}" },
  { label: "Name", value: "{{name}}" },
  { label: "Company", value: "{{company}}" },
  { label: "Phone", value: "{{phone}}" },
  { label: "Role", value: "{{role}}" },
  { label: "Business Name", value: "{{businessName}}" },
  { label: "City", value: "{{city}}" },
  { label: "Country", value: "{{country}}" },
  { label: "Industry", value: "{{industry}}" },
  { label: "Niche", value: "{{niche}}" },
  { label: "Website", value: "{{website}}" },
  { label: "Revenue", value: "{{revenue}}" },
];

const PREBUILT_TEMPLATES = [
  { id: "cold", label: "Cold Outreach", cat: "Outreach", subject: "Quick question, {{firstName}}?", body: "Hi {{firstName}},\n\nI came across {{company}} and was impressed by {{industry}}.\n\nI have an idea that could help {{company}} increase outreach efficiency by 3x.\n\nWould you be open to a quick 10-min call this week?\n\nBest,\n{{sender_name}}" },
  { id: "followup", label: "Follow-up Sequence", cat: "Follow-up", subject: "Re: Quick question", body: "Hi {{firstName}},\n\nJust circling back on my previous message. I know you're busy, but I'd love to connect.\n\nWe've helped companies like {{company}} achieve great results with our outreach solution.\n\nWorth a quick chat?\n\nBest,\n{{sender_name}}" },
  { id: "partnership", label: "Partnership Proposal", cat: "Business", subject: "Partnership opportunity with {{company}}", body: "Hi {{firstName}},\n\nI've been following {{company}}'s growth in the {{industry}} space and I think there's a strong synergy between us.\n\nWe help companies automate sales outreach and {{company}} could greatly benefit.\n\nWould you be open to exploring a partnership?\n\nCheers,\n{{sender_name}}" },
  { id: "breakup", label: "Breakup Email", cat: "Follow-up", subject: "Closing the loop", body: "Hi {{firstName}},\n\nI've reached out a few times without hearing back, so I'll assume the timing isn't right.\n\nIf things change at {{company}}, feel free to reach out. I'd be happy to help.\n\nWishing you all the best,\n{{sender_name}}" },
  { id: "referral", label: "Referral Request", cat: "Business", subject: "Who else at {{company}}?", body: "Hi {{firstName}},\n\nLoved our conversation! I was wondering — who else at {{company}} might benefit from what we discussed?\n\nA warm intro would mean a lot.\n\nThanks,\n{{sender_name}}" },
  { id: "webinar", label: "Event Invite", cat: "Outreach", subject: "Join us: Outreach Masterclass", body: "Hi {{firstName}},\n\nWe're hosting a free webinar on scaling sales outreach with AI.\n\nGiven {{company}}'s focus on {{industry}}, I think you'd find it valuable.\n\nSeats are limited — would you like a spot?\n\nBest,\n{{sender_name}}" },
];

const VARIABLE_GROUPS = [
  { label: "Contact", vars: ["{{firstName}}", "{{lastName}}", "{{name}}", "{{phone}}", "{{role}}"] },
  { label: "Company", vars: ["{{company}}", "{{businessName}}", "{{industry}}", "{{niche}}", "{{revenue}}", "{{website}}", "{{city}}", "{{country}}"] },
  { label: "System", vars: ["{{sender_name}}", "{{senderName}}", "{{sender.email}}"] },
];

export default function UnifiedCampaignWizard({ isOpen, onClose, onSuccess, initialLeads = [] }: UnifiedCampaignWizardProps) {
  const { toast } = useToast();
  const { data: user } = useUser();
  const userId = user?.id;
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [activeTab, setActiveTab] = useState("S1");
  const [previewDevice, setPreviewDevice] = useState<"ios" | "android">("ios");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [cleanMode, setCleanMode] = useState(false);
  const [showLeadRecoveryPreflight, setShowLeadRecoveryPreflight] = useState(false);
  const [leadRecoveryWarning, setLeadRecoveryWarning] = useState("");

  // State Management
  const [sourceType, setSourceType] = useState<'upload' | 'database'>('upload');
  const [leads, setLeads] = useState<Array<{ id: string; name?: string; email?: string; metadata?: Record<string, any>; company?: string; city?: string; industry?: string; niche?: string; website?: string; phone?: string; role?: string; businessName?: string; country?: string; revenue?: string }>>(initialLeads);
  const [importProgress, setImportProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [syncLimit, setSyncLimit] = useState<number | 'all'>(1000);
  const [mailboxSearch, setMailboxSearch] = useState("");
  const [mailboxRenderLimit, setMailboxRenderLimit] = useState(30);

  const [mailboxLimits, setMailboxLimits] = useState<Record<string, number>>({});
  const [initialOutreachLimits, setInitialOutreachLimits] = useState<Record<string, number>>({});
  const [mailboxMaxMultipliers, setMailboxMaxMultipliers] = useState<Record<string, number>>({});
  const [defaultPerMailbox, setDefaultPerMailbox] = useState(35);
  const [useDefaultForAll, setUseDefaultForAll] = useState(true);
  const [selectedMailboxes, setSelectedMailboxes] = useState<string[]>([]);

  // When default changes or selection changes, apply same limit to ALL mailboxes
  useEffect(() => {
    if (!useDefaultForAll || selectedMailboxes.length === 0) return;
    setMailboxLimits(prev => {
      const next = { ...prev };
      for (const id of selectedMailboxes) {
        next[id] = defaultPerMailbox;
      }
      return next;
    });
  }, [defaultPerMailbox, selectedMailboxes, useDefaultForAll]);

  const [campaignName, setCampaignName] = useState("");
  const [targetDays, setTargetDays] = useState(10);
  const [excludeWeekends, setExcludeWeekends] = useState(false);
  const [aiAutonomousMode, setAiAutonomousMode] = useState(true);
  const [aiAdjustCopy, setAiAdjustCopy] = useState(false);
  const [threadFollowUp, setThreadFollowUp] = useState(true);
  const [replyTo, setReplyTo] = useState("");
  
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [enableFollowups, setEnableFollowups] = useState(false);
  const [followups, setFollowups] = useState<Array<{ subject: string, body: string, delayDays: string, isBreakup?: boolean }>>([]);

  const [autoReplyBody, setAutoReplyBody] = useState("");
  const [selTemplate, setSelTemplate] = useState("");
  const [varGroup, setVarGroup] = useState("Contact");
  const [activeVarField, setActiveVarField] = useState("body");
  const [launchProgress, setLaunchProgress] = useState<{ id: string; name: string; sent: number; total: number; status: string } | null>(null);

  // Unsubscribe config
  const [unsubscribeMethods, setUnsubscribeMethods] = useState<string[]>(["link", "header"]);
  const [unsubscribeApplyTo, setUnsubscribeApplyTo] = useState<string>("both");

  const unsubscribeOptions = [
    { value: "link", label: "Link in email", desc: "Appends {{unsubscribe_link}} footer" },
    { value: "header", label: "List-Unsubscribe header", desc: "Gmail/Outlook native button" },
    { value: "reply", label: "Reply opt-out", desc: "AI marks as unsubscribed on reply" },
    { value: "none", label: "No unsubscribe", desc: "Skip all unsubscribe (risk of spam complaints)" },
  ];

  const toggleUnsubscribeMethod = (val: string) => {
    if (val === "none") {
      setUnsubscribeMethods(["none"]);
      return;
    }
    const next = unsubscribeMethods.filter(m => m !== "none");
    if (next.includes(val)) {
      setUnsubscribeMethods(next.filter(m => m !== val));
    } else {
      setUnsubscribeMethods([...next, val]);
    }
  };

  // Fetch only email mailboxes (not calendar/instagram) — reduces payload from 500-item full list
  const { data: integrations = [] } = useQuery<any[]>({
    queryKey: ['/api/integrations', { provider: 'custom_email,gmail,outlook', connected: 'true' }],
    select: (data: any) => data.integrations || [],
    staleTime: 30_000,
  });

  const availableMailboxes = useMemo(() => (
    (integrations || [])
      .filter((i: any) => ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected)
      .sort((a: any, b: any) => String(a.email || a.accountType || a.id).localeCompare(String(b.email || b.accountType || b.id)))
  ), [integrations]);

  const filteredWizardMailboxes = useMemo(() => {
    if (!mailboxSearch.trim()) return availableMailboxes;
    const q = mailboxSearch.toLowerCase();
    return availableMailboxes.filter((mb: any) =>
      String(mb.email || mb.accountType || mb.id).toLowerCase().includes(q) ||
      String(mb.provider || '').toLowerCase().includes(q)
    );
  }, [availableMailboxes, mailboxSearch]);

  const getMailboxAddress = (mb: any) => mb.email || mb.accountType || mb.metadata?.email || mb.metadata?.smtp_user || "Connected mailbox";
  const getDefaultMailboxLimit = (mb: any) => {
    // Single source of truth: integrations.dailyLimit DB column
    const storedLimit = Number(mb.dailyLimit || 0);
    if (Number.isFinite(storedLimit) && storedLimit > 0) {
      // Apply graceful throttle from reputation system if set
      const graceful = mb.gracefulDailyLimit != null ? Number(mb.gracefulDailyLimit) : null;
      if (graceful !== null && graceful > 0 && graceful < storedLimit) return graceful;
      return storedLimit;
    }
    if (mb.provider === 'custom_email') return 250;
    return 50;
  };
  const getSafeMailboxCeiling = (mb: any) => mb.provider === 'custom_email' ? 500 : 60;

  useEffect(() => {
    if (availableMailboxes.length > 0) {
      setMailboxLimits(prev => {
        const next = { ...prev };
        availableMailboxes.forEach((mb: any) => {
          if (!next[mb.id]) next[mb.id] = Math.min(getDefaultMailboxLimit(mb), getSafeMailboxCeiling(mb));
        });
        return next;
      });
      setInitialOutreachLimits(prev => {
        const next = { ...prev };
        availableMailboxes.forEach((mb: any) => {
          if (!next[mb.id]) next[mb.id] = mb.initialOutreachLimit ?? 50;
        });
        return next;
      });
      setMailboxMaxMultipliers(prev => {
        const next = { ...prev };
        availableMailboxes.forEach((mb: any) => {
          if (!next[mb.id]) next[mb.id] = 1;
        });
        return next;
      });
    }
  }, [availableMailboxes]);

  useEffect(() => {
    if (availableMailboxes.length > 0 && selectedMailboxes.length === 0) {
      setSelectedMailboxes(availableMailboxes.map((mb: any) => mb.id));
    }
  }, [availableMailboxes]);

  // Reset render window when user searches — show matches from top
  useEffect(() => { setMailboxRenderLimit(30); }, [mailboxSearch]);

  // Forecast & Scaling Intelligence
  const activeFollowups = enableFollowups ? followups.filter(f => f.body.trim()) : [];
  const totalEmailsPerLead = 1 + activeFollowups.length;
  const totalCampaignVolume = leads.length * totalEmailsPerLead;
  
  const totalDailyVolume = selectedMailboxes.reduce((sum, id) => sum + (mailboxLimits[id] || 50), 0);
  const maxTotalVolume = selectedMailboxes.reduce((sum, id) => sum + (mailboxLimits[id] || 50) * (mailboxMaxMultipliers[id] || 1), 0);

  const sendingDaysPerWeek = excludeWeekends ? 5 : 7;
  const calendarDayMultiplier = excludeWeekends ? 7 / 5 : 1;
  const estimatedSendingDays = leads.length > 0 && totalDailyVolume > 0 ? Math.ceil(leads.length / totalDailyVolume) : 0;
  const estimatedDays = Math.ceil(estimatedSendingDays * calendarDayMultiplier);
  const isExtendedTimeline = enableFollowups && targetDays > 0 ? estimatedDays > targetDays : false;
  const requiredDailyVolume = enableFollowups && targetDays > 0 ? Math.ceil(leads.length / Math.max(1, targetDays / calendarDayMultiplier)) : 0;
  const mailboxesNeeded = isExtendedTimeline ? Math.max(0, Math.ceil((requiredDailyVolume - totalDailyVolume) / 50)) : 0;

  // Reputation cap: keep autonomous pacing under provider-safe defaults.
  const NEURAL_CAP = 50; 
  const effectiveSafeDailyVolume = selectedMailboxes.length * Math.min(NEURAL_CAP, totalDailyVolume / (selectedMailboxes.length || 1));
  
  const estimatedDaysToFinish = leads.length > 0 && effectiveSafeDailyVolume > 0 
    ? Math.ceil(Math.ceil(leads.length / effectiveSafeDailyVolume) * calendarDayMultiplier) 
    : 0;

  // The total timeline including follow-up delays
  const lastFollowUp = activeFollowups[activeFollowups.length - 1];
  const maxFollowUpDelay = lastFollowUp ? parseInt(lastFollowUp.delayDays || "0") : 0;
  const totalTimelineDays = enableFollowups
    ? estimatedDaysToFinish + maxFollowUpDelay
    : estimatedDaysToFinish;
  // Human-readable delay summary for the forecast card
  const delaySummary = enableFollowups && activeFollowups.length > 0
    ? activeFollowups.map((f, i) => `${f.delayDays}d`).join(' → ')
    : '';

  // Preview content follows the active tab
  const previewSubject = activeTab === "S1" ? subject
    : activeTab === "Auto" ? `Re: ${subject}`
    : followups[parseInt(activeTab.replace('S', '')) - 2]?.subject || subject;
  const previewBody = activeTab === "S1" ? body
    : activeTab === "Auto" ? autoReplyBody
    : followups[parseInt(activeTab.replace('S', '')) - 2]?.body || body;

  const hasUnsafeMailbox = selectedMailboxes.some(id => {
    const mailbox = availableMailboxes.find((mb: any) => mb.id === id);
    return mailbox ? (mailboxLimits[id] || 0) > getSafeMailboxCeiling(mailbox) : false;
  });
  const minimumDaysAtCurrentCapacity = totalDailyVolume > 0 ? estimatedDays : 0;

  // Plan-based campaign limits
  const planId = getActivePlanId(user);
  const campaignLimits = getCampaignLimits(planId);
  const exceedsMailboxLimit = isFinite(campaignLimits.maxMailboxesPerCampaign) && selectedMailboxes.length > campaignLimits.maxMailboxesPerCampaign;
  const exceedsLeadLimit = isFinite(campaignLimits.maxLeadsPerCampaign) && leads.length > campaignLimits.maxLeadsPerCampaign;

  const launchIssues = [
    !campaignName.trim() ? "Name your campaign" : null,
    !subject.trim() ? "Write a subject line" : null,
    leads.length === 0 ? "Add leads" : null,
    selectedMailboxes.length === 0 ? "Select at least one inbox" : null,
    hasUnsafeMailbox ? "Lower unsafe mailbox limits" : null,
    exceedsMailboxLimit ? `Your ${planId} plan allows ${campaignLimits.maxMailboxesPerCampaign} mailboxes per campaign` : null,
    exceedsLeadLimit ? `Your ${planId} plan allows ${campaignLimits.maxLeadsPerCampaign} leads per campaign` : null,
  ].filter(Boolean) as string[];

  useEffect(() => {
    const saved = localStorage.getItem("campaign_draft");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.campaignName) setCampaignName(data.campaignName);
        if (data.subject) setSubject(data.subject);
        if (data.body) setBody(data.body);
        if (data.enableFollowups) {
          setEnableFollowups(true);
          if (data.followups && data.followups.length > 0) {
            setFollowups(data.followups);
          } else {
            setFollowups([{ delayDays: "3", subject: "", body: "", isBreakup: false }]);
          }
        }
        if (data.autoReplyBody) setAutoReplyBody(data.autoReplyBody);
        if (data.threadFollowUp !== undefined) setThreadFollowUp(data.threadFollowUp);
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const draft = { campaignName, subject, body, followups, autoReplyBody, totalDailyVolume, targetDays, excludeWeekends, threadFollowUp, enableFollowups };
      localStorage.setItem("campaign_draft", JSON.stringify(draft));
    }
  }, [campaignName, subject, body, followups, autoReplyBody, totalDailyVolume, targetDays, excludeWeekends, isOpen]);

  // Poll campaign progress on step 3
  useEffect(() => {
    if (step !== 3 || !launchProgress?.id) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/outreach/campaigns/${launchProgress.id}`);
        if (res.ok) {
          const data = await res.json();
          setLaunchProgress(prev => prev ? {
            ...prev,
            sent: data.stats?.sent || prev.sent,
            total: data.stats?.total || prev.total,
            status: data.status || prev.status,
          } : prev);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [step, launchProgress?.id]);

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
      const limitParam = syncLimit === 'all' ? campaignLimits.maxLeadsPerCampaign : syncLimit;
      const res = await apiRequest("GET", `/api/leads?limit=${limitParam}&excludeActiveCampaignLeads=true`);
      const data = await res.json();
      if (data.leads) {
        // Store slim objects only — full lead data is not needed in the wizard
        const slim = (data.leads as any[]).map((l: any) => ({ id: l.id, name: l.name, email: l.email }));
        setLeads(slim);
        toast({ title: "Leads Fetched", description: `Successfully loaded ${slim.length} leads.` });
      }
    } catch (err: any) {
      toast({ title: "Fetch failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoadingLeads(false);
    }
  };

  const handleLaunch = async (skipLeadRecoveryPreflight = false) => {
    if (!campaignName) {
      toast({ title: "Name Required", description: "Please name your campaign before launching.", variant: "destructive" });
      return;
    }
    if (launchIssues.length > 0) {
      toast({ title: "Campaign not ready", description: launchIssues.join(", "), variant: "destructive" });
      return;
    }

    if (!skipLeadRecoveryPreflight) {
      try {
        const preflightRes = await apiRequest("GET", "/api/lead-recovery/preflight");
        const preflight = await preflightRes.json();
        if (preflight.shouldSuggest) {
          setLeadRecoveryWarning(preflight.warning || "");
          setShowLeadRecoveryPreflight(true);
          return;
        }
      } catch {
        // Lead Recovery can be gated or unavailable; do not block campaign creation.
      }
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
          mailboxLimits: Object.fromEntries(selectedMailboxes.map(id => [id, mailboxLimits[id] || 35])),
          initialOutreachLimits: Object.fromEntries(selectedMailboxes.map(id => [id, initialOutreachLimits[id] ?? 50])),
          mailboxMaxMultipliers,
          mailboxIds: selectedMailboxes,
          targetDays,
          estimatedDays,
          minimumDaysAtCurrentCapacity,
          replyTo: replyTo || undefined,
          aiAdjustCopy,
          threadFollowUp
        },
        template: {
          subject,
          body,
          initial: { subject, body },
          followups: enableFollowups ? activeFollowups.map(f => ({
            subject: f.subject || subject,
            body: f.body,
            delayDays: parseInt(f.delayDays),
            isBreakup: f.isBreakup
          })) : [],
          autoReply: { body: aiAutonomousMode ? '' : autoReplyBody },
          autoReplyBody: aiAutonomousMode ? '' : autoReplyBody,
          unsubscribe: unsubscribeMethods.includes("none") ? { method: "none" } : {
            method: unsubscribeMethods,
            applyTo: unsubscribeApplyTo
          }
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
      localStorage.removeItem("campaign_draft");
      localStorage.removeItem(`campaign_draft_${userId}`);
      setLaunchProgress({ id: campaign.id, name: campaignName, sent: 0, total: campaign.leadCount || leads.length, status: 'starting' });
      onSuccess?.();
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

  // Dynamic Tags aggregated from ALL leads' metadata (not just first)
  const dynamicTags = useMemo(() => {
    const keys = new Set<string>();
    for (let i = 0; i < Math.min(leads.length, 200); i++) {
      const meta = leads[i]?.metadata;
      if (meta) {
        for (const k of Object.keys(meta)) {
          if (!k.endsWith('_type') && k !== '_unmapped_cols') {
            keys.add(k);
          }
        }
      }
    }
    return Array.from(keys).map(k => ({ label: k.replace(/_/g, ' '), value: `{{${k}}}` }));
  }, [leads]);

  const allTags = useMemo(() => [
    ...DEFAULT_PERSONALIZATION_TAGS,
    ...dynamicTags.filter(dt => !DEFAULT_PERSONALIZATION_TAGS.some(st => st.value === dt.value))
  ], [dynamicTags]);

  const handleGenerateSequence = async () => {
    setIsGeneratingAI(true);
    try {
      const followupCount = enableFollowups ? followups.length : 0;
      const res = await apiRequest("POST", "/api/outreach/generate-template", { 
        focus: "high-conversion",
        count: followupCount,
        delayDays: enableFollowups ? followups.map(f => parseInt(f.delayDays) || 3) : []
      });
      const { sequence } = await res.json();
      if (sequence) {
        setSubject(sequence.subject || "");
        setBody(sequence.body || "");
        if (enableFollowups && sequence.followups && Array.isArray(sequence.followups)) {
          setFollowups(sequence.followups.map((f: any) => ({
            subject: f.subject || "",
            body: f.body || "",
            delayDays: String(f.delayDays || "3")
          })));
        }
        setAutoReplyBody(sequence.autoReplyBody || "");
        toast({ title: "Sequence Generated!", description: `AI drafted your ${followupCount > 0 ? followupCount + 1 + '-step' : 'initial'} sequence.` });
      }
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const insertTag = (tag: string, field: string) => {
    const t = tag.includes("{{") ? tag : `{{${tag}}}`;
    if (field === "subject") setSubject(prev => prev + t);
    else if (field === "body") setBody(prev => prev + t);
    else if (field === "auto") setAutoReplyBody(prev => prev + t);
    else if (field.startsWith("fs")) {
      const idx = parseInt(field.replace("fs", ""));
      const newF = [...followups];
      newF[idx].subject = (newF[idx].subject || "") + t;
      setFollowups(newF);
    }
    else if (field.startsWith("fb")) {
      const idx = parseInt(field.replace("fb", ""));
      const newF = [...followups];
      newF[idx].body = (newF[idx].body || "") + t;
      setFollowups(newF);
    }
  };

  const applyTemplate = (id: string) => {
    const t = PREBUILT_TEMPLATES.find(t => t.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
    setSelTemplate(id);
    setStep(2);
  };

  const renderVarDropdown = (field: string) => (
    <div className="flex flex-wrap gap-2 mb-3 items-center">
      <Tags className="w-3 h-3 text-muted-foreground mr-1" />
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mr-2">Insert:</span>
      <Select value={varGroup} onValueChange={setVarGroup}>
        <SelectTrigger className="h-7 w-[100px] text-[10px] bg-muted/10 border-border/20 rounded-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VARIABLE_GROUPS.map(g => <SelectItem key={g.label} value={g.label} className="text-xs">{g.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex gap-1 flex-wrap">
        {(VARIABLE_GROUPS.find(g => g.label === varGroup)?.vars || []).map(tag => (
          <button
            key={tag}
            onClick={() => insertTag(tag.replace(/[{}]/g, ""), field)}
            className="text-[9px] font-semibold uppercase tracking-widest px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary transition-all active:scale-95"
          >
            {tag.replace(/[{}]/g, "")}
          </button>
        ))}
      </div>
      {allTags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mr-1">Custom:</span>
          {allTags.filter(t => !VARIABLE_GROUPS.some(g => g.vars.includes(t.value))).map(t => (
            <button
              key={t.value}
              onClick={() => insertTag(t.value.replace(/[{}]/g, ""), field)}
              className="text-[9px] px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 transition-all active:scale-95"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const highlightVars = (text: string) => {
    if (!text) return null;
    const parts = text.split(/({{[^}]+}})/g);
    return parts.map((part, i) => {
      if (part.startsWith("{{") && part.endsWith("}}")) {
        return <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary font-mono text-[10px] font-bold">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const renderPreview = (subj: string, content: string) => {
    const sampleLead = leads[0] || { 
      name: "Prospect Name", 
      company: "Company Inc.",
      phone: "+1-555-0100",
      role: "Founder",
      businessName: "Acme Corp",
      city: "San Francisco",
      country: "United States",
      industry: "SaaS",
      niche: "B2B Software",
      website: "example.com",
      revenue: "$10M ARR"
    };
    const firstName = sampleLead.name?.trim().split(' ')[0] || 'Prospect';
    const lastName = sampleLead.name?.trim().split(' ').slice(1).join(' ') || '';

    const fullName = sampleLead.name?.trim() || firstName;
    const process = (text: string) => {
      let processed = (text || "")
        .replace(/{{firstName}}/g, firstName)
        .replace(/{{lastName}}/g, lastName)
        .replace(/{{name}}/g, fullName)
        .replace(/{{lead_name}}/g, fullName)
        .replace(/{{company}}/g, sampleLead.company || sampleLead.metadata?.company || 'Acme Corp')
        .replace(/{{phone}}/g, sampleLead.phone || sampleLead.metadata?.phone || '')
        .replace(/{{role}}/g, sampleLead.role || sampleLead.metadata?.role || '')
        .replace(/{{businessName}}/g, sampleLead.businessName || sampleLead.metadata?.businessName || sampleLead.metadata?.business_name || '')
        .replace(/{{city}}/g, sampleLead.city || sampleLead.metadata?.city || 'Remote')
        .replace(/{{country}}/g, sampleLead.country || sampleLead.metadata?.country || '')
        .replace(/{{industry}}/g, sampleLead.industry || sampleLead.metadata?.industry || 'Business')
        .replace(/{{niche}}/g, sampleLead.niche || sampleLead.metadata?.niche || 'Business')
        .replace(/{{website}}/g, sampleLead.website || sampleLead.metadata?.website || 'your site')
        .replace(/{{revenue}}/g, sampleLead.revenue || sampleLead.metadata?.revenue || '');

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
    <>
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-full lg:max-w-[96vw] xl:max-w-[1280px] w-full h-[100dvh] lg:h-[94vh] rounded-none lg:rounded-xl p-0 overflow-hidden bg-background border-border/40 flex flex-col shadow-2xl">
        <div className="p-6 md:p-8 flex items-center justify-between border-b border-border/40 bg-card/50 backdrop-blur-xl shrink-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Send className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg md:text-2xl font-semibold tracking-tight uppercase">Campaign Wizard</DialogTitle>
              <div className="flex gap-2 mt-1">
                {[1, 2].map(i => <div key={i} className={cn("h-1.5 rounded-full transition-all duration-500", step === i ? "w-8 bg-primary" : "w-2 bg-muted")} />)}
              </div>
            </div>
          </div>
          <DialogClose asChild><Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/80 transition-colors"><X className="h-4 w-4 opacity-70" /></Button></DialogClose>
        </div>

        <div className="flex flex-1 overflow-hidden relative">
          <div className="flex-1 flex flex-col w-full relative">
            <div className="flex-1 overflow-y-auto w-full">
              <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-8 pb-32">
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] gap-6">
                      <div className="space-y-6">
                        <div className="space-y-3">
                          <Label className="text-[10px] font-semibold uppercase tracking-widest opacity-40">Campaign Identity</Label>
                          <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g. Project Nova" className="h-12 bg-muted/20 border-0 font-semibold text-sm rounded-xl" />
                        </div>
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <Label className="text-[10px] font-semibold uppercase tracking-widest opacity-40">Connected Inboxes</Label>
                            <div className="flex items-center gap-2">
                              <Badge variant={exceedsMailboxLimit ? 'destructive' : 'secondary'} className="text-[9px] font-bold uppercase">
                                {isFinite(campaignLimits.maxMailboxesPerCampaign)
                                  ? `${selectedMailboxes.length}/${campaignLimits.maxMailboxesPerCampaign} Mailboxes`
                                  : `${selectedMailboxes.length} Mailboxes (Unlimited)`}
                              </Badge>
                              <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedMailboxes(availableMailboxes.map((mb: any) => mb.id))} className="h-8 rounded-lg text-[10px] font-bold uppercase">All</Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedMailboxes([])} className="h-8 rounded-lg text-[10px] font-bold uppercase">Clear</Button>
                              </div>
                            </div>
                          </div>
                          {availableMailboxes.length === 0 && (
                            <div className="rounded-xl border border-dashed border-border/60 p-5 text-sm text-muted-foreground">
                              Connect Gmail, Outlook, or SMTP before launching a campaign.
                            </div>
                          )}
                          {availableMailboxes.length > 5 && (
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                placeholder={`Search ${availableMailboxes.length} mailboxes...`}
                                value={mailboxSearch}
                                onChange={e => setMailboxSearch(e.target.value)}
                                className="h-8 pl-9 text-xs bg-muted/20 border-border/40 rounded-lg"
                              />
                            </div>
                          )}
                          <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 mb-4">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex-1">
                                <Label className="text-[10px] font-semibold uppercase tracking-widest opacity-60">Default Per-Mailbox Limit</Label>
                                <div className="flex items-center gap-3 mt-2">
                                  <Input
                                    type="number"
                                    value={defaultPerMailbox}
                                    onChange={e => setDefaultPerMailbox(Math.max(5, parseInt(e.target.value) || 35))}
                                    min={5}
                                    max={200}
                                    className="w-24 h-8 text-sm font-bold bg-muted/20 border-border/40 rounded-lg text-center"
                                  />
                                  <span className="text-[10px] text-muted-foreground/60">
                                    / day × {selectedMailboxes.length || 1} mailbox{selectedMailboxes.length !== 1 ? 'es' : ''}
                                    {selectedMailboxes.length > 0 && (
                                      <span className="text-primary font-bold ml-2">
                                        = {defaultPerMailbox * selectedMailboxes.length} total/day
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold uppercase text-muted-foreground/60">Apply to All</span>
                                <button
                                  type="button"
                                  onClick={() => setUseDefaultForAll(!useDefaultForAll)}
                                  className={cn(
                                    "w-8 h-4 rounded-full transition-colors relative",
                                    useDefaultForAll ? "bg-primary" : "bg-muted"
                                  )}
                                >
                                  <div className={cn(
                                    "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform",
                                    useDefaultForAll ? "translate-x-4" : "translate-x-0.5"
                                  )} />
                                </button>
                              </div>
                            </div>
                            {!useDefaultForAll && (
                              <p className="text-[9px] text-amber-500/80 mt-2">Off — each mailbox's slider below sets its own limit.</p>
                            )}
                          </div>

                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground/60">{selectedMailboxes.length} of {availableMailboxes.length} selected</span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedMailboxes(availableMailboxes.map(m => m.id))}
                                className="text-[9px] font-bold uppercase text-primary hover:text-primary/80 transition-colors"
                              >
                                Select All
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedMailboxes([])}
                                className="text-[9px] font-bold uppercase text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
                            {filteredWizardMailboxes.length === 0 && mailboxSearch && (
                              <p className="text-xs text-muted-foreground text-center py-4">No mailboxes match "{mailboxSearch}"</p>
                            )}
                            {filteredWizardMailboxes.slice(0, mailboxRenderLimit).map(mb => {
                              const isSelected = selectedMailboxes.includes(mb.id);
                              const safeCeiling = getSafeMailboxCeiling(mb);
                              return (
                                <div key={mb.id}
                                  className={cn("p-4 rounded-xl border transition-all", isSelected ? "border-primary bg-primary/5 shadow-sm" : "border-border/40 opacity-70")}>
                                  <div className="flex items-start justify-between gap-3 mb-3 text-xs font-semibold">
                                    <button
                                      type="button"
                                      onClick={() => isSelected ? setSelectedMailboxes(selectedMailboxes.filter(id => id !== mb.id)) : setSelectedMailboxes([...selectedMailboxes, mb.id])}
                                      className="flex min-w-0 items-center gap-2 text-left"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {}}
                                        className="w-3.5 h-3.5 rounded border-border accent-primary"
                                      />
                                      <Mail className="w-3 h-3 shrink-0" />
                                      <span className="truncate">{getMailboxAddress(mb)}</span>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <Badge variant="outline" className="text-[9px] uppercase">{mb.provider === 'custom_email' ? 'SMTP' : mb.provider}</Badge>
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1" onClick={e => e.stopPropagation()}>
                                      <div className="flex justify-between text-[9px] font-semibold uppercase tracking-widest">
                                        <span className="opacity-40">Max per Day (initial + follow-ups)</span>
                                        <span className="text-primary">{mailboxLimits[mb.id] || 35}/day</span>
                                      </div>
                                      <div className="text-[9px] text-muted-foreground/60 italic mb-2">
                                        Spreads evenly across 24h.
                                      </div>
                                      <Slider 
                                        value={[mailboxLimits[mb.id] || 35]} 
                                        onValueChange={v => {
                                          setMailboxLimits(prev => ({ ...prev, [mb.id]: v[0] }));
                                          // Persist to DB so this becomes the new default for this mailbox
                                          apiRequest('PATCH', `/api/integrations/${mb.id}/daily-limit`, { dailyLimit: v[0] }).catch(() => {});
                                        }} 
                                        min={5} 
                                        max={safeCeiling} 
                                        step={5} 
                                      />
                                      <div className="flex justify-between text-[9px] font-semibold tracking-wider mt-1">
                                        <span className="text-muted-foreground/60">~{Math.round((mailboxLimits[mb.id] || 35) / 24)}/hr (1 every {Math.round(1440 / (mailboxLimits[mb.id] || 35))}min)</span>
                                        <span className="text-primary">{mailboxLimits[mb.id] || 35}/day max</span>
                                      </div>

                                      {/* Initial Throttle — starts slow, ramps up */}
                                      <div className="border-t border-border/10 pt-3 mt-2">
                                        <div className="flex justify-between text-[9px] font-semibold uppercase tracking-widest">
                                          <span className="opacity-60">Initial Throttle (first days)</span>
                                          <span className="text-amber-400">{initialOutreachLimits[mb.id] ?? 50}/day</span>
                                        </div>
                                        <div className="text-[9px] text-muted-foreground/60 italic mb-2">
                                          Day one send rate. Auto-ramps as reputation builds.
                                        </div>
                                        <Slider 
                                          value={[initialOutreachLimits[mb.id] ?? 50]} 
                                          onValueChange={v => {
                                            setInitialOutreachLimits(prev => ({ ...prev, [mb.id]: v[0] }));
                                            apiRequest('PATCH', `/api/integrations/${mb.id}/outreach-limit`, { initialOutreachLimit: v[0] }).catch(() => {});
                                          }} 
                                          min={1} 
                                          max={mailboxLimits[mb.id] || 50} 
                                          step={1} 
                                        />
                                        <div className="flex justify-between text-[9px] font-medium tracking-wider mt-1">
                                          <span className="text-muted-foreground/60">Starts at this rate</span>
                                          <span className="text-amber-400/70">{initialOutreachLimits[mb.id] ?? 50}/day initial</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {filteredWizardMailboxes.length > mailboxRenderLimit && (
                              <button
                                type="button"
                                onClick={() => setMailboxRenderLimit(n => n + 30)}
                                className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors border border-dashed border-border/40 rounded-xl"
                              >
                                + Load {Math.min(30, filteredWizardMailboxes.length - mailboxRenderLimit)} more &nbsp;
                                <span className="opacity-50">({filteredWizardMailboxes.length - mailboxRenderLimit} remaining)</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <Label className="text-[10px] font-semibold uppercase tracking-widest opacity-40">Target Population</Label>
                          <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => setSourceType('database')} className={cn("p-4 rounded-2xl border-2 text-left transition-all", sourceType === 'database' ? "border-primary bg-primary/5 shadow-lg" : "border-border/40")}>
                              <Database className="w-5 h-5 mb-2 opacity-50" />
                              <p className="text-xs font-bold uppercase">Existing</p>
                            </button>
                            <button onClick={() => setSourceType('upload')} className={cn("p-4 rounded-2xl border-2 text-left transition-all", sourceType === 'upload' ? "border-primary bg-primary/5 shadow-lg" : "border-border/40")}>
                              <Upload className="w-5 h-5 mb-2 opacity-50" />
                              <p className="text-xs font-bold uppercase">Upload</p>
                            </button>
                          </div>
                          {sourceType === 'upload' ? (
                            <label className="border-2 border-dashed border-primary/20 hover:border-primary/40 p-8 rounded-2xl text-center cursor-pointer flex flex-col items-center gap-3 bg-primary/5 transition-all">
                              <input type="file" className="hidden" onChange={handleFileUpload} />
                              <Sparkles className="h-6 w-6 text-primary" />
                              <div className="font-bold uppercase text-[10px] tracking-wider">Drop CSV or PDF here</div>
                            </label>
                          ) : (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 relative">
                                  <Input 
                                    type={syncLimit === 'all' ? 'text' : 'number'}
                                    value={syncLimit === 'all' ? `MAX (${campaignLimits.maxLeadsPerCampaign.toLocaleString()})` : syncLimit}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (val === '') {
                                        setSyncLimit(0);
                                      } else {
                                        const parsed = parseInt(val);
                                        if (!isNaN(parsed)) setSyncLimit(Math.max(0, Math.min(campaignLimits.maxLeadsPerCampaign, parsed)));
                                      }
                                    }}
                                    disabled={syncLimit === 'all'}
                                    className="h-12 bg-muted/20 border-border/40 rounded-xl pl-10 font-semibold text-sm"
                                  />
                                  <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
                                </div>
                                <Button 
                                  variant={syncLimit === 'all' ? 'default' : 'outline'}
                                  onClick={() => setSyncLimit(syncLimit === 'all' ? 1000 : 'all')}
                                  className="h-12 px-6 rounded-xl font-bold text-xs uppercase tracking-wider shrink-0"
                                >
                                  {syncLimit === 'all' ? 'Custom' : 'All Leads'}
                                </Button>
                              </div>
                              <Button 
                                onClick={handleFetchLeads} 
                                disabled={isLoadingLeads || (syncLimit !== 'all' && syncLimit <= 0)}
                                className="w-full h-12 rounded-xl bg-primary/10 border-primary/20 text-primary text-xs font-bold uppercase tracking-wider hover:bg-primary/20 flex items-center justify-center gap-3 transition-all"
                              >
                                {isLoadingLeads ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                {syncLimit === 'all' ? 'Fetch Entire Workforce Pool' : `Sync ${syncLimit} Available Leads`}
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="p-5 sm:p-6 bg-primary/5 rounded-xl border border-primary/10 space-y-6">
                           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                             <div className="flex items-center gap-2 text-primary">
                               <Sparkles className="w-5 h-5 animate-pulse" />
                               <span className="text-[10px] font-semibold uppercase tracking-widest">Growth Engine Plan</span>
                               <Badge variant={exceedsLeadLimit ? 'destructive' : 'secondary'} className="text-[9px] font-bold uppercase">
                                 {leads.length}/{campaignLimits.maxLeadsPerCampaign} Leads
                               </Badge>
                             </div>
                             <div className="flex items-center gap-2">
                               {hasUnsafeMailbox && (
                                 <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-[9px] font-semibold px-3 py-1">
                                   REPUTATION RISK
                                 </Badge>
                               )}
                               {totalDailyVolume > 0 && !hasUnsafeMailbox && (
                                 <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[9px] font-semibold px-3 py-1">
                                   HEALTHY VELOCITY
                                 </Badge>
                               )}
                             </div>
                           </div>

                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                              <div>
                                <p className="text-[9px] uppercase font-semibold opacity-40 mb-1">Daily Capacity</p>
                                <p className={cn("text-2xl font-bold tracking-tight transition-all", totalDailyVolume === 0 ? "text-muted-foreground/30" : "text-foreground")}>
                                  ~{totalDailyVolume}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60">Total throughput</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase font-semibold opacity-40 mb-1">Per Mailbox</p>
                                <p className={cn("text-2xl font-bold tracking-tight transition-all", totalDailyVolume === 0 ? "text-muted-foreground/30" : "text-foreground")}>
                                  {selectedMailboxes.length > 0 ? Math.floor(totalDailyVolume / selectedMailboxes.length) : 0}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60">Avg. daily limit</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase font-semibold opacity-40 text-amber-600 mb-1 flex items-center gap-1">
                                  Boost Buffer
                                </p>
                                <p className={cn("text-2xl font-bold tracking-tight transition-all", totalDailyVolume === 0 ? "text-amber-600/30" : "text-amber-600")}>
                                  +{maxTotalVolume - totalDailyVolume}
                                </p>
                                <p className="text-[10px] text-amber-600/60">Reserved headroom</p>
                              </div>
                              <div>
                                <p className="text-[9px] uppercase font-semibold opacity-40 text-primary mb-1">
                                  {syncLimit === 'all' ? 'Workforce Velocity' : 'Campaign Velocity'}
                                </p>
                                <p className={cn("text-2xl font-bold tracking-tight transition-all", totalDailyVolume === 0 ? "text-primary/30" : "text-primary")}>
                                  {estimatedDays}d
                                </p>
                                <p className="text-[10px] text-primary/60">
                                  Time to finish {syncLimit === 'all' ? 'all' : leads.length} leads
                                </p>
                              </div>
                            </div>

                           {totalDailyVolume === 0 && (
                             <div className="p-4 bg-muted/20 border border-border/40 rounded-xl text-[10px] font-bold opacity-70">
                               No mailboxes selected. Select at least one connected inbox above to calculate the plan.
                             </div>
                           )}

                           {(isExtendedTimeline || leads.length > 5000) && (
                            <div className={cn(
                              "p-4 sm:p-5 rounded-xl animate-in fade-in zoom-in-95 mt-4 transition-all",
                              isExtendedTimeline ? "bg-amber-500/5 border border-amber-500/20" : "bg-primary/5 border border-primary/10"
                            )}>
                              <div className="flex items-center gap-2 mb-2">
                                <Sparkles className={cn("w-4 h-4", isExtendedTimeline ? "text-amber-500" : "text-primary")} />
                                <span className={cn("text-[10px] font-semibold uppercase tracking-widest", isExtendedTimeline ? "text-amber-600" : "text-primary")}>
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
                    <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-6 border-b border-border/10">
                        <Label className="text-xs font-semibold uppercase tracking-[0.2em] opacity-40">Sequence Designer ({1 + (enableFollowups ? followups.length : 0)} {enableFollowups ? 'Steps' : 'Email'})</Label>
                        <Button onClick={handleGenerateSequence} disabled={isGeneratingAI} className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground gap-3 font-bold uppercase tracking-wider text-xs px-6 h-11 w-full sm:w-auto">
                          {isGeneratingAI ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} AI Wizard Generate
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="p-5 sm:p-6 bg-primary/5 rounded-xl border border-primary/20 flex flex-col gap-4 col-span-1 md:col-span-2">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-[11px] font-semibold uppercase text-primary">AI Autonomous Engine</p>
                              <p className="text-[10px] opacity-60 italic mt-1 max-w-lg">Autonomously manages follow-ups, bookings, and payments via AI intelligence.</p>
                            </div>
                            <Switch checked={aiAutonomousMode} onCheckedChange={setAiAutonomousMode} className="scale-125 data-[state=checked]:bg-primary" />
                          </div>
                          
                          {aiAutonomousMode && (
                            <div className="space-y-4 pt-4 border-t border-primary/10 animate-in fade-in slide-in-from-top-2">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase">Let AI Adjust Copy</p>
                                   <p className="text-[9px] opacity-60 italic mt-1 font-bold text-primary">AI rewrites follow-ups when replies contradict the planned message.</p>
                                </div>
                                <Switch checked={aiAdjustCopy} onCheckedChange={setAiAdjustCopy} className="scale-110" />
                              </div>
                              
                              <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/10 flex items-start gap-3">
                                <Sparkles className="w-4 h-4 text-emerald-500 mt-0.5" />
                                <div>
                                  <p className="text-[10px] font-semibold uppercase text-emerald-600 tracking-widest">Autonomous pacing active</p>
                                   <p className="text-[9px] text-emerald-600/70 font-bold">Paces sends within mailbox limits. Unsafe mailboxes stay blocked.</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="p-5 sm:p-6 bg-muted/10 rounded-xl border border-border/10 space-y-3">
                           <Label className="text-[9px] font-semibold uppercase opacity-40">Reply-To Routing</Label>
                           <Input value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="alias@domain.com" className="bg-background border-border/20 font-semibold text-xs h-11 rounded-xl" />
                           <p className="text-[8px] text-muted-foreground/70 font-bold leading-relaxed">When leads reply, their response goes to this address instead of your sending mailbox. Leave empty to use the default sender address.</p>
                        </div>
                        <div className="p-5 sm:p-6 bg-muted/10 rounded-xl border border-border/10 flex items-center justify-between gap-4">
                           <div>
                             <p className="text-[10px] font-semibold uppercase">Weekend Protection</p>
                             <p className="text-[9px] opacity-40 mt-1 text-emerald-600">Pauses sending on Saturdays/Sundays</p>
                           </div>
                           <Switch checked={excludeWeekends} onCheckedChange={setExcludeWeekends} className="scale-110" />
                        </div>
                        <div className="p-5 sm:p-6 bg-muted/10 rounded-xl border border-border/10 flex items-center justify-between gap-4">
                           <div>
                             <p className="text-[10px] font-semibold uppercase">Thread Follow-ups</p>
                             <p className="text-[9px] opacity-40 mt-1 text-primary">Replies in the same email thread for better deliverability</p>
                           </div>
                            <Switch checked={threadFollowUp} onCheckedChange={v => {
                              setThreadFollowUp(v);
                              if (v) {
                                setFollowups(prev => prev.map(f => ({ ...f, subject: "" })));
                              }
                            }} className="scale-110" />
                        </div>
                      </div>

                        {/* Enable Follow-ups toggle */}
                        <div className="p-5 sm:p-6 bg-muted/10 rounded-xl border border-border/10 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-[10px] font-semibold uppercase">Enable Follow-up Sequence</p>
                            <p className="text-[9px] opacity-40 mt-1">Add automated follow-up emails after the initial send</p>
                          </div>
                          <Switch
                            checked={enableFollowups}
                            onCheckedChange={v => {
                              setEnableFollowups(v);
                              if (v && followups.length === 0) {
                                setFollowups([{ delayDays: "3", subject: "", body: "", isBreakup: false }]);
                              }
                              if (!v) {
                                setFollowups([]);
                              }
                            }}
                            className="scale-110"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                            <div className="text-[10px] font-semibold uppercase opacity-40 mb-1">Forecast</div>
                            <div className="text-lg font-bold tracking-tight">{totalCampaignVolume.toLocaleString()} <span className="text-[10px] opacity-40 font-normal">EMAILS</span></div>
                          </div>
                          <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                            <div className="text-[10px] font-semibold uppercase opacity-40 mb-1">Batch Completion</div>
                            <div className="text-lg font-bold tracking-tight">{estimatedDaysToFinish} <span className="text-[10px] opacity-40 font-normal">DAYS</span></div>
                          </div>
                           <div className={cn("p-4 rounded-2xl border transition-all", enableFollowups && totalTimelineDays > 28 ? "bg-orange-500/10 border-orange-500/20" : "bg-primary/5 border-primary/10")}>
                             <div className="text-[10px] font-semibold uppercase opacity-40 mb-1">Full Sequence</div>
                             <div className="text-lg font-bold tracking-tight">{totalTimelineDays} <span className="text-[10px] opacity-40 font-normal">{enableFollowups ? "DAYS" : "DAYS (INITIAL ONLY)"}</span></div>
                             {enableFollowups && delaySummary && (
                               <div className="text-[8px] text-muted-foreground/60 font-bold mt-1 uppercase tracking-wider">Initial → {delaySummary}</div>
                             )}
                           </div>
                        </div>
                        {enableFollowups && totalTimelineDays > 28 && (
                           <div className="text-[10px] font-bold text-orange-500 bg-orange-500/5 p-3 rounded-xl border border-orange-500/10">
                             Sequence exceeds 28 days. Add more mailboxes or adjust safe limits to speed up.
                           </div>
                        )}
                        {enableFollowups && (
                          <div className="space-y-3 pt-2 pb-4 border-b border-border/10">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] font-semibold uppercase tracking-widest opacity-40">Sequence Duration Goal: {targetDays} Days</Label>
                              <Badge className="bg-primary/10 text-primary text-[8px] font-semibold w-fit">{minimumDaysAtCurrentCapacity || 0}d minimum</Badge>
                            </div>
                            <Slider value={[targetDays]} onValueChange={v => setTargetDays(v[0])} min={1} max={90} step={1} className="py-2" />
                            <p className="text-[10px] text-muted-foreground/60">Set your target timeline. Follow-up delays and mailbox capacity determine the actual pace.</p>
                          </div>
                        )}
                        <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/10 text-[10px] leading-relaxed opacity-80">
                           Routing and pacing run continuously, including when new selected mailboxes are connected mid-campaign.
                        </div>

                      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <div className="flex items-center gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                          <TabsList className="h-16 flex-1 bg-muted/20 p-2 rounded-2xl border border-border/10 flex gap-3 min-w-max">
                            <TabsTrigger value="S1" className="flex-1 rounded-xl text-[10px] font-semibold uppercase tracking-tighter data-[state=active]:bg-background data-[state=active]:shadow-xl transition-all h-full px-6">Initial Email</TabsTrigger>
                            {enableFollowups && followups.map((_, i) => (
                              <TabsTrigger key={`S${i+2}`} value={`S${i+2}`} className="flex-1 rounded-xl text-[10px] font-semibold uppercase tracking-tighter data-[state=active]:bg-background data-[state=active]:shadow-xl transition-all h-full px-6">{`S${i+2}`}</TabsTrigger>
                            ))}
                            {!aiAutonomousMode && (
                              <TabsTrigger value="Auto" className="flex-1 rounded-xl text-[10px] font-semibold uppercase tracking-tighter data-[state=active]:bg-background data-[state=active]:shadow-xl transition-all h-full px-6">Auto Reply</TabsTrigger>
                            )}
                          </TabsList>
                          
                          {enableFollowups && (
                            <div className="flex gap-2">
                              <Button 
                                variant="outline" 
                                size="icon" 
                                onClick={() => {
                                  if (followups.length < 10) {
                                    setFollowups([...followups, { delayDays: "3", subject: "", body: "", isBreakup: false }]);
                                  }
                                }}
                                className="h-16 w-16 rounded-2xl border-dashed border-primary/20 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                                title="Add Follow-up Step"
                              >
                                <Plus className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                              </Button>
                               {followups.length > 0 && (
                                  <div className="flex gap-2">
                                    <Button 
                                      variant="outline" 
                                      size="icon" 
                                      onClick={() => setFollowups(followups.slice(0, -1))}
                                      className="h-16 w-16 rounded-2xl border-dashed border-orange-500/20 hover:border-orange-500/50 hover:bg-orange-500/5 transition-all group"
                                      title="Remove last follow-up step"
                                    >
                                      <span className="text-[18px] text-orange-500 font-semibold leading-none">&#8722;</span>
                                    </Button>
                                    <Button 
                                      variant="outline" 
                                      size="icon" 
                                      onClick={() => {
                                        setFollowups([]);
                                        setEnableFollowups(false);
                                      }}
                                      className="h-16 w-16 rounded-2xl border-dashed border-red-500/20 hover:border-red-500/50 hover:bg-red-500/5 transition-all group"
                                      title="Remove all follow-ups and disable sequence"
                                    >
                                      <Trash2 className="w-4 h-4 text-red-500 group-hover:scale-110 transition-transform" />
                                    </Button>
                                  </div>
                               )}
                            </div>
                          )}
                        </div>

                        <TabsContent value="S1" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                           <div className="flex items-center gap-2 mb-4">
                             <FileText className="w-4 h-4 text-muted-foreground" />
                             <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Template</span>
                             <Select value={selTemplate} onValueChange={applyTemplate}>
                               <SelectTrigger className="h-8 w-[200px] text-[11px] bg-muted/10 border-border/20 rounded-full">
                                 <SelectValue placeholder="Pre-built templates..." />
                               </SelectTrigger>
                               <SelectContent>
                                 {["Outreach", "Follow-up", "Business"].map(cat => (
                                   <div key={cat}>
                                     <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">{cat}</div>
                                     {PREBUILT_TEMPLATES.filter(t => t.cat === cat).map(t => (
                                       <SelectItem key={t.id} value={t.id} className="text-xs">{t.label}</SelectItem>
                                     ))}
                                   </div>
                                 ))}
                               </SelectContent>
                             </Select>
                           </div>
                           <div className="space-y-2">
                             {renderVarDropdown("subject")}
                             <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="SUBJECT LINE" className="h-12 bg-muted/20 border border-border/40 font-semibold text-sm rounded-xl px-6" />
                             {subject && <div className="px-3 py-1.5 bg-muted/5 rounded-lg text-xs font-mono">{highlightVars(subject)}</div>}
                           </div>
                           <div className="space-y-2">
                             {renderVarDropdown("body")}
                             <Textarea value={body} onChange={e => setBody(e.target.value)} className="min-h-[350px] bg-muted/5 border border-border/40 rounded-xl p-6 text-sm leading-relaxed resize-none font-sans" placeholder="Craft the perfect proposal..." />
                             {body && <div className="px-3 py-2 bg-muted/5 rounded-lg text-xs leading-relaxed font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">{highlightVars(body)}</div>}
                           </div>
                        </TabsContent>

                        {followups.map((f, i) => (
                          <TabsContent key={`S${i+2}`} value={`S${i+2}`} className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                              <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-3">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      const newF = followups.filter((_, idx) => idx !== i);
                                      if (newF.length === 0) setEnableFollowups(false);
                                      setFollowups(newF);
                                    }}
                                    className="w-6 h-6 rounded-full hover:bg-destructive/10 hover:text-destructive"
                                    title="Remove this step"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-3 h-3 text-primary/60" />
                                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">Sends after</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  <Select 
                                    value={String(f.delayDays || "3")} 
                                    onValueChange={v => {
                                      const newF = [...followups];
                                      newF[i].delayDays = v;
                                      setFollowups(newF);
                                    }}
                                  >
                                    <SelectTrigger className="w-[130px] h-9 text-[11px] uppercase font-semibold border-primary/20 bg-primary/5"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {Array.from({ length: 30 }, (_, index) => index + 1).map(d => (
                                        <SelectItem key={d} value={d.toString()}>{d} {d === 1 ? 'Day' : 'Days'}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <div className="flex items-center gap-2">
                                    <Label className="text-[9px] font-semibold uppercase tracking-widest opacity-40">Breakup</Label>
                                    <Switch 
                                      checked={f.isBreakup} 
                                      onCheckedChange={v => {
                                        const newF = [...followups];
                                        newF[i].isBreakup = v;
                                        setFollowups(newF);
                                      }}
                                      className="scale-75"
                                    />
                                  </div>
                             </div>
                           </div>
                              <div className="space-y-2">
                                {renderVarDropdown(`fs${i}`)}
                                <div className="relative">
                                  <Input 
                                    value={threadFollowUp ? (subject || "Original subject will be inherited") : f.subject} 
                                    onChange={e => {
                                      if (threadFollowUp) return;
                                      const newF = [...followups];
                                      newF[i].subject = e.target.value;
                                      setFollowups(newF);
                                    }} 
                                    placeholder={threadFollowUp ? `Inherits: "${subject || 'Original Subject'}"` : `S${i+2} SUBJECT (OPTIONAL)`} 
                                    className={cn(
                                      "h-12 bg-muted/20 border font-semibold text-sm rounded-xl px-6",
                                      threadFollowUp 
                                        ? "border-dashed border-primary/30 text-muted-foreground/60 cursor-not-allowed opacity-60" 
                                        : "border-border/40"
                                    )}
                                    readOnly={threadFollowUp}
                                    tabIndex={threadFollowUp ? -1 : 0}
                                  />
                                  {threadFollowUp && (
                                    <div className="absolute -top-2 right-2 px-2 py-0.5 bg-primary/10 rounded-full text-[8px] font-bold text-primary uppercase tracking-wider border border-primary/20">
                                      Auto-threaded
                                    </div>
                                   )}
                                 </div>
                                 {f.subject && !threadFollowUp && <div className="px-3 py-1.5 bg-muted/5 rounded-lg text-xs font-mono">{highlightVars(f.subject)}</div>}
                               </div>
                              <div className="space-y-2">
                                {renderVarDropdown(`fb${i}`)}
                               <Textarea 
                                 value={f.body} 
                                 onChange={e => {
                                   const newF = [...followups];
                                   newF[i].body = e.target.value;
                                   setFollowups(newF);
                                 }} 
                                 className="min-h-[300px] bg-muted/5 border border-border/40 rounded-xl p-6 text-sm font-sans"
                                  placeholder={`FOLLOW UP #${i+1} MESSAGE...`} 
                                />
                                {f.body && <div className="px-3 py-2 bg-muted/5 rounded-lg text-xs leading-relaxed font-mono whitespace-pre-wrap max-h-20 overflow-y-auto">{highlightVars(f.body)}</div>}
                              </div>
                           </TabsContent>
                         ))}

                         {!aiAutonomousMode && (
                         <TabsContent value="Auto" className="space-y-6">
                               <div className="p-4 bg-muted/10 border border-border/10 rounded-2xl text-[10px] font-bold">Static auto-reply sent when lead first replies (AI mode off).</div>
                              <div className="space-y-2">
                                {renderVarDropdown("auto")}
                                <Textarea value={autoReplyBody} onChange={e => setAutoReplyBody(e.target.value)} className="min-h-[250px] bg-muted/5 border border-border/40 rounded-xl p-6 text-sm font-sans" placeholder="Thanks for reaching out! We'll be with you soon..." />
                                {autoReplyBody && <div className="px-3 py-2 bg-muted/5 rounded-lg text-xs leading-relaxed font-mono whitespace-pre-wrap max-h-20 overflow-y-auto">{highlightVars(autoReplyBody)}</div>}
                              </div>
                         </TabsContent>
                          )}
                        </Tabs>

                        {/* Unsubscribe Settings */}
                        <div className="p-5 rounded-xl border border-border/20 bg-card/50">
                          <div className="flex items-center gap-2 mb-4">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Unsubscribe</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                            {unsubscribeOptions.map(opt => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => toggleUnsubscribeMethod(opt.value)}
                                className={`p-3 rounded-xl text-left border text-[10px] font-semibold transition-all ${
                                  unsubscribeMethods.includes(opt.value) || (opt.value === "none" && unsubscribeMethods.includes("none"))
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-muted/5 border-border/20 text-muted-foreground hover:border-border/40"
                                }`}
                              >
                                <div className="text-xs font-bold mb-0.5">
                                  {opt.value === "link" ? "Link" : opt.value === "header" ? "Header" : opt.value === "reply" ? "Reply" : "None"}
                                </div>
                                <div className="opacity-60 leading-tight">{opt.desc}</div>
                              </button>
                            ))}
                          </div>
                          {!unsubscribeMethods.includes("none") && unsubscribeMethods.length > 0 && (
                            <div className="flex items-center gap-3">
                              <span className="text-[9px] font-bold uppercase tracking-widest opacity-40">Apply to</span>
                              <Select value={unsubscribeApplyTo} onValueChange={setUnsubscribeApplyTo}>
                                <SelectTrigger className="h-8 w-[180px] text-[11px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="initial">Initial email only</SelectItem>
                                  <SelectItem value="followups">Follow-ups only</SelectItem>
                                  <SelectItem value="both">All emails</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                    {step === 3 && launchProgress && (
                     <motion.div key="step3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 py-4">
                       <div className="p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-center space-y-3">
                         <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                           <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                         </div>
                         <h3 className="text-lg font-semibold tracking-tight">Campaign Launched</h3>
                         <p className="text-sm text-muted-foreground">{launchProgress.name} is now active</p>
                       </div>
                       <div className="space-y-3">
                         <div className="flex justify-between text-xs">
                           <span className="font-bold text-muted-foreground">Progress</span>
                           <span className="font-mono text-primary">{launchProgress.sent} / {launchProgress.total}</span>
                         </div>
                         <Progress value={(launchProgress.sent / Math.max(launchProgress.total, 1)) * 100} className="h-2 bg-muted/20 [&>div]:bg-gradient-to-r [&>div]:from-primary [&>div]:to-emerald-500" />
                         <p className="text-[10px] text-muted-foreground text-center">Queue processing — updates in real-time</p>
                       </div>
                       <div className="flex gap-3">
                         <Button className="flex-1" variant="outline" onClick={onClose}>Close</Button>
                         <Button className="flex-1" onClick={() => { onClose(); setTimeout(() => window.location.href = '/dashboard/inbox', 100); }}>
                           View in Inbox <ArrowRight className="h-4 w-4 ml-2" />
                         </Button>
                       </div>
                     </motion.div>
                   )}
                 </AnimatePresence>
              </div>
            </div>

            <div className="p-4 sm:p-6 md:p-8 border-t border-border/20 bg-card/95 backdrop-blur-2xl flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between shrink-0 sticky bottom-0 z-30 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6 md:pb-8">
              <Button variant="ghost" onClick={() => step > 1 && step < 3 ? setStep(step - 1) : onClose()} className="h-12 px-8 rounded-xl font-bold uppercase text-[10px] tracking-wider hover:bg-muted/50 transition-all font-sans w-full sm:w-auto">{step === 1 ? 'Discard' : step === 3 ? 'Close' : 'Back'}</Button>
              {step === 1 ? (
                <Button 
                  disabled={leads.length === 0 || !campaignName || selectedMailboxes.length === 0 || isLoadingLeads} 
                  onClick={() => setStep(2)} 
                  className={cn(
                    "h-12 px-4 sm:px-8 rounded-xl font-bold uppercase tracking-wider transition-all group font-sans flex flex-col items-center justify-center gap-0 relative overflow-hidden w-full sm:w-auto",
                    (leads.length === 0 || selectedMailboxes.length === 0 || isLoadingLeads) ? "bg-muted text-muted-foreground" : "bg-primary hover:bg-primary/90 text-primary-foreground"
                  )}
                >
                  {isLoadingLeads && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center backdrop-blur-sm">
                      <div className="h-5 w-5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs">
                    Design Outreach Sequence <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <span className="text-[8px] font-bold opacity-50 tracking-widest mt-0.5">
                    {isLoadingLeads ? "SYNCING DATABASE..." : (leads.length === 0 ? "ADD LEADS TO CONTINUE" : (selectedMailboxes.length === 0 ? "SELECT AN INBOX TO CONTINUE" : "NEXT: CRAFT YOUR AI OUTREACH SEQUENCE"))}
                  </span>
                </Button>
              ) : step === 2 ? (
                <Button onClick={() => handleLaunch()} disabled={isLoading || !subject || !body || launchIssues.length > 0} className="h-12 px-12 rounded-xl font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-3 transition-all font-sans relative w-full sm:w-auto">
                  {isLoading ? "LAUNCHING..." : "LAUNCH CAMPAIGN"} <Plus className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex-[0.7] relative overflow-hidden bg-gradient-to-br from-transparent to-primary/5 hidden lg:block border-l border-border/10">
            <div className="absolute top-10 left-1/2 -translate-x-1/2 w-full px-10 text-center">
               <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-30">Live Mobile Engagement Simulation</p>
            </div>
             {renderPreview(previewSubject, previewBody)}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-4 bg-background/50 backdrop-blur-xl border border-border/20 p-2 rounded-full shadow-2xl scale-90">
               <Button onClick={() => setPreviewDevice('ios')} variant={previewDevice === 'ios' ? 'default' : 'ghost'} size="icon" className="rounded-full w-10 h-10"><Smartphone className="w-4 h-4" /></Button>
               <Button onClick={() => setPreviewDevice('android')} variant={previewDevice === 'android' ? 'default' : 'ghost'} size="icon" className="rounded-full w-10 h-10"><Monitor className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={showLeadRecoveryPreflight} onOpenChange={setShowLeadRecoveryPreflight}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Activate Lead Recovery first?
          </DialogTitle>
          <DialogDescription>
            Lead Recovery works best before outbound sending starts, so recovery syncs do not compete with active campaign mailboxes.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
          {leadRecoveryWarning}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowLeadRecoveryPreflight(false); void handleLaunch(true); }}>
            Skip for now
          </Button>
          <Button onClick={async () => {
            try {
              await apiRequest("POST", "/api/lead-recovery/activate", {});
              toast({ title: "Lead Recovery activated", description: "Starting the read-only 90-day email sync." });
            } catch (error: any) {
              toast({ title: "Lead Recovery unavailable", description: error.message, variant: "destructive" });
            } finally {
              setShowLeadRecoveryPreflight(false);
            }
          }}>
            Activate Recovery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
