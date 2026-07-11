import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useCanAccessVoiceNotes } from "@/hooks/use-access-gate";
import { useMailbox } from "@/hooks/use-mailbox";
import { useRealtime } from "@/hooks/use-realtime";
import {
  Instagram,
  Mail,
  Check,
  Shield,
  Loader2,
  CheckCircle2,
  Pencil,
  Sparkles,
  Zap,
  Globe,
  Upload,
  FileText,
  AlertCircle,
  Plus,
  ShieldCheck,
  Activity,
  Cpu,
  Unplug,
  RefreshCw,
  FolderSync,
  ArrowRight,
  Search,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  CalendarDays,
  Info,
  Construction,
} from "lucide-react";
import { SiGoogle, SiShopify, SiHubspot, SiSlack } from "react-icons/si";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getPlanCapabilities, getActivePlanId } from "@shared/plan-utils";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface Integration {
  id?: string;
  provider: string;
  connected: boolean;
  lastSync?: string;
  accountType?: string;
  accountInfo?: {
    email?: string;
    username?: string;
  };
  reputationScore?: number;
  bounceRate?: number;
}

interface IntegrationsResponse {
  integrations: Integration[];
}

interface UserData {
  id: string;
  email: string;
  subscriptionTier?: string;
  plan?: string;
  totalLeads?: number;
}

interface BulkMailboxImportRow {
  email: string;
  password: string;
  passwordType?: string;
  smtpHost: string;
  smtpPort?: string;
  imapHost?: string;
  imapPort?: string;
  fromName?: string;
  smtpUser?: string;
  imapUser?: string;
}

type BulkMailboxField = keyof BulkMailboxImportRow;

const BULK_MAILBOX_HEADERS: Record<BulkMailboxField, string[]> = {
  email: ["email", "mailbox", "address", "username", "smtpuser", "smtp_user", "smtp user"],
  password: ["password", "pass", "apppassword", "app_password", "app password", "smtppass", "smtp_pass", "smtp pass", "mailboxpassword", "mailbox_password", "mailbox pass"],
  passwordType: ["passwordtype", "password_type", "password type", "credentialtype", "credential_type", "credential type"],
  smtpHost: ["smtphost", "smtp_host", "smtp host", "smtpserver", "smtp_server", "smtp server"],
  smtpPort: ["smtpport", "smtp_port", "smtp port"],
  imapHost: ["imaphost", "imap_host", "imap host", "imapserver", "imap_server", "imap server"],
  imapPort: ["imapport", "imap_port", "imap port"],
  fromName: ["fromname", "from_name", "from name", "name", "displayname", "display_name", "display name"],
  smtpUser: ["smtpusername", "smtp_username", "smtp username"],
  imapUser: ["imapuser", "imap_user", "imap user", "imapusername", "imap_username", "imap username"],
};

function normalizeBulkHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_ ]/g, '').replace(/\s+/g, ' ');
}

function mapBulkHeader(header: string): BulkMailboxField | null {
  const normalized = normalizeBulkHeader(header);
  for (const [field, aliases] of Object.entries(BULK_MAILBOX_HEADERS)) {
    if (aliases.includes(normalized) || aliases.includes(normalized.replace(/\s/g, ''))) {
      return field as BulkMailboxField;
    }
  }
  return null;
}

function parseDelimitedRows(content: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseBulkMailboxFile(content: string): { rows: BulkMailboxImportRow[]; errors: string[] } {
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/\t/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? '\t' : ',';
  const parsed = parseDelimitedRows(content, delimiter);
  if (parsed.length < 2) return { rows: [], errors: ["The file needs a header row and at least one mailbox row."] };

  const fields = parsed[0].map(mapBulkHeader);
  const required = new Set<BulkMailboxField>(["email", "password", "smtpHost"]);
  const mappedRequired = new Set(fields.filter(Boolean) as BulkMailboxField[]);
  const missing = [...required].filter(field => !mappedRequired.has(field));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [`Missing required columns: ${missing.join(', ')}. Required: email, password, smtpHost.`]
    };
  }

  const errors: string[] = [];
  const rows: BulkMailboxImportRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const source = parsed[i];
    const row: Partial<BulkMailboxImportRow> = {};
    fields.forEach((field, index) => {
      if (field && source[index]) row[field] = source[index];
    });

    if (!row.email || !row.password || !row.smtpHost) {
      errors.push(`Row ${i + 1}: missing email, password, or SMTP host.`);
      continue;
    }

    rows.push(row as BulkMailboxImportRow);
  }

  return { rows, errors };
}

const integrationCards: Array<{
  do: "social" | "calendar";
  id: string;
  name: string;
  description: string;
  icon: any;
  color: string;
  bg: string;
  badge?: string;
  freePlanNote?: string;
}> = [
  {
    do: "social",
    id: "instagram",
    name: "Instagram",
    description: "Automate DMs and lead responses on your Instagram account.",
    icon: Instagram,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    badge: "Coming Soon",
  },
  {
    do: "calendar",
    id: "calendly",
    name: "Calendly",
    description: "AI-led appointment scheduling. Automatically book meetings with interested leads.",
    icon: CalendarDays,
    color: "text-blue-600",
    bg: "bg-blue-600/10",
    freePlanNote: "OAuth & scheduling links work on the free plan. Real-time booking webhooks require Calendly Standard ($12/mo).",
  }
];


function DisconnectConfirmationDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  providerName
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  providerName: string;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {providerName}?</DialogTitle>
          <DialogDescription>
            Are you sure you want to disconnect? The AI will stop processing leads from this source immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { onConfirm(); onOpenChange(false); }}>Yes, Disconnect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CircularProgress = ({ value, label, sublabel, color = "primary" }: { value: number, label: string, sublabel: string, color?: string }) => (
  <div className="flex flex-col items-center gap-2">
    <div className="relative h-24 w-24">
      <svg className="h-full w-full rotate-[-90deg]">
        <circle
          cx="48"
          cy="48"
          r="36"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          className="text-muted/10"
        />
        <motion.circle
          cx="48"
          cy="48"
          r="36"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          strokeDasharray="226.2"
          initial={{ strokeDashoffset: 226.2 }}
          animate={{ strokeDashoffset: 226.2 - (226.2 * Math.min(value, 100)) / 100 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className={cn(color === "primary" ? "text-primary" : "text-emerald-500")}
          style={{ strokeLinecap: "round" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black tracking-tighter">{label}</span>
      </div>
    </div>
    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{sublabel}</span>
  </div>
);

export default function IntegrationsPage() {
  const { socket } = useRealtime();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedMailboxId } = useMailbox();
  const [customEmailConfig, setCustomEmailConfig] = useState({
    smtpHost: '',
    smtpPort: '587',
    imapHost: '',
    imapPort: '993',
    email: '',
    password: '',
    fromName: ''
  });
  const [testEmailData, setTestEmailData] = useState({ recipient: "", subject: "Test Email", content: "This is a test email." });
  const [isTestEmailOpen, setIsTestEmailOpen] = useState(false);
  const [isEditingCustomEmail, setIsEditingCustomEmail] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [disconnectProvider, setDisconnectProvider] = useState<string | null>(null);
  const [disconnectIntegrationId, setDisconnectIntegrationId] = useState<string | null>(null);

  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [passwordType, setPasswordType] = useState<'app_password' | 'mailbox_password'>('mailbox_password');
  const [appPasswordGuide, setAppPasswordGuide] = useState<any>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const bulkMailboxInputRef = useRef<HTMLInputElement>(null);
  const [bulkMailboxFileName, setBulkMailboxFileName] = useState("");
  const [bulkMailboxRows, setBulkMailboxRows] = useState<BulkMailboxImportRow[]>([]);
  const [bulkMailboxErrors, setBulkMailboxErrors] = useState<string[]>([]);
  const [mailboxSearch, setMailboxSearch] = useState("");
  const [mailboxPage, setMailboxPage] = useState(0);
  const [showAllMailboxes, setShowAllMailboxes] = useState(false);
  const MAILBOXES_PER_PAGE = 25;

  const [integrationPage, setIntegrationPage] = useState(1);
  const [integrationSearch, setIntegrationSearch] = useState("");
  const [localLimits, setLocalLimits] = useState<Record<string, number>>({});

  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (integrationSearch) params.set("search", integrationSearch);
    params.set("page", String(integrationPage));
    params.set("limit", "25");
    return ["/api/integrations", params.toString()];
  }, [integrationSearch, integrationPage]);

  const { data: integrationsData, isLoading } = useQuery<{
    integrations: Array<any>; total: number; page: number; pages: number;
  }>({
    queryKey,
    placeholderData: (prev: any) => prev,
    staleTime: 30_000,
    refetchOnMount: true,
  });
  const { data: customEmailStatus, refetch: refetchStatus } = useQuery<{
    connected: boolean;
    email: string | null;
    integrations: Array<{ id: string; email: string; connected: boolean; provider: string; reputationScore?: number; bounceRate?: number; dailyLimit?: number }>;
  }>({
    queryKey: ["/api/custom-email/status"],
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: folderData } = useQuery<{ success: boolean; inbox: string[]; sent: string[]; isDiscovering: boolean }>({
    queryKey: ["/api/custom-email/folders"],
    enabled: !!customEmailStatus?.connected,
    placeholderData: (prev) => prev,
  });
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats", { integrationId: selectedMailboxId }],
  });
  const { data: userData } = useQuery<UserData>({ queryKey: ["/api/user/profile"] });

  const getDailyLimit = () => {
    const tier = (getActivePlanId(userData)).toLowerCase();
    if (tier === 'enterprise') return 1000000; // Effectively Unlimited in UI
    if (tier === 'pro') return 400;
    return 300; // Default / Starter
  };

  // Memoized reputation values to avoid repeated function calls and non-null assertions
  const reputationStr = stats?.domainHealth !== undefined && stats.domainHealth !== null ? stats.domainHealth.toFixed(2) : null;
  const reputationNum = reputationStr !== null ? parseFloat(reputationStr) : null;

  useEffect(() => {
    // 1. Handle success redirect from OAuth (Gmail/Outlook/Calendly/Instagram)
    const searchParams = new URLSearchParams(window.location.search);
    const success = searchParams.get('success');
    
    if (success) {
      const providers: Record<string, string> = {
        'gmail_connected': 'Gmail',
        'outlook_connected': 'Outlook',
        'calendly_connected': 'Calendly',
        'instagram_connected': 'Instagram',
        'google_calendar_connected': 'Google Calendar'
      };

      if (providers[success]) {
        toast({ 
          title: `${providers[success]} Connected`, 
          description: "Your account is ready for use." 
        });
        queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
        // Part 5: Invalidate channel status so inbox doesn't show "Connect Sources" after OAuth
        queryClient.invalidateQueries({ queryKey: ["/api/channels/all"] });
        // Refresh inbox so it shows the newly connected mailbox's leads immediately
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });

        // Robust re-fetch with slight delay to ensure backend propagation
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
          queryClient.invalidateQueries({ queryKey: ["/api/channels/all"] });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        }, 1500);
      }
      
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [queryClient]);

  // Real-time listener for reputation and health updates
  useEffect(() => {
    const handleStatsUpdated = () => {
      console.log("[Realtime] Health stats updated, refetching...");
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
    };

    if (socket) {
      socket.on('stats_updated', handleStatsUpdated);
      socket.on('integration_health_updated', handleStatsUpdated);
    }

    return () => {
      if (socket) {
        socket.off('stats_updated', handleStatsUpdated);
        socket.off('integration_health_updated', handleStatsUpdated);
      }
    };
  }, [queryClient, socket]);

  const integrations = useMemo(() => {
    if (!integrationsData) return [];
    if (Array.isArray(integrationsData)) return integrationsData;
    return (integrationsData as any)?.integrations ?? [];
  }, [integrationsData]);
  const totalIntegrations = useMemo(() =>
    (integrationsData as any)?.total ?? integrations.length, [integrationsData, integrations.length]
  );
  const totalIntegrationPages = useMemo(() =>
    (integrationsData as any)?.pages ?? 1, [integrationsData]
  );
  const allMailboxes = useMemo(() => customEmailStatus?.integrations || [], [customEmailStatus]);
  const hasMailboxesConnected = allMailboxes.length > 0;

  const filteredMailboxes = useMemo(() => {
    if (!mailboxSearch.trim()) return allMailboxes;
    const q = mailboxSearch.toLowerCase();
    return allMailboxes.filter(m =>
      (m.email || "").toLowerCase().includes(q) ||
      (m.provider || "").toLowerCase().includes(q)
    );
  }, [allMailboxes, mailboxSearch]);

  const totalMailboxPages = Math.ceil(filteredMailboxes.length / MAILBOXES_PER_PAGE);
  // Show only first 5 by default; "View More" reveals all (then standard pagination kicks in)
  const INITIAL_VISIBLE = 5;
  const pagedMailboxes = useMemo(() => {
    const base = filteredMailboxes.slice(mailboxPage * MAILBOXES_PER_PAGE, (mailboxPage + 1) * MAILBOXES_PER_PAGE);
    if (mailboxSearch.trim()) return base; // search overrides compact view
    if (showAllMailboxes) return base;
    return base.slice(0, INITIAL_VISIBLE);
  }, [filteredMailboxes, mailboxPage, showAllMailboxes, mailboxSearch]);

  const resetMailboxPagination = useCallback(() => setMailboxPage(0), []);

  const verifyDomainMutation = useMutation({
    mutationFn: async (domain: string) => {
      const res = await apiRequest("POST", "/api/dns/verify", { domain, force: true });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Check Complete", description: "Domain reputation updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats", { integrationId: selectedMailboxId }] });
    },
    onError: (err: any) => toast({ title: "Verification Failed", description: err.message, variant: "destructive" })
  });

  const disconnectProviderMutation = useMutation({
    mutationFn: async ({ provider, integrationId }: { provider: string, integrationId?: string }) => {
      let url = `/api/integrations/${provider}/disconnect`;
      if (integrationId) {
        url += `?integrationId=${integrationId}`;
      }
      const response = await apiRequest("POST", url);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({ title: "Disconnected", description: "Integration removed successfully." });
    }
  });

  const connectCustomEmailMutation = useMutation({
    mutationFn: async (config: typeof customEmailConfig & { passwordType?: string }) => {
      const response = await apiRequest("POST", "/api/custom-email/connect", config);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      setIsEditingCustomEmail(false);
      setCustomEmailConfig({ smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993', email: '', password: '', fromName: '' });
      if (data.smtpVerified) {
        toast({ title: "Email Connected & Verified", description: "SMTP credentials are working. Mailbox is ready." });
      } else {
        toast({ title: "Email Saved (Unverified)", description: data.smtpVerifyError || "SMTP verification failed. Sending may not work until credentials are corrected.", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      let errorMsg = error.message;
      let tipMsg = '';
      try {
        const jsonStr = error.message.replace(/^\d+:\s*/, '');
        const parsed = JSON.parse(jsonStr);
        errorMsg = parsed.error || errorMsg;
        tipMsg = parsed.tip || '';
      } catch { }
      const description = tipMsg ? `${errorMsg}\n\n${tipMsg}` : errorMsg;
      toast({ title: "Connection Failed", description, variant: "destructive" });
    }
  });

  const bulkMailboxImportMutation = useMutation({
    mutationFn: async (mailboxes: BulkMailboxImportRow[]) => {
      const response = await apiRequest("POST", "/api/custom-email/bulk-import", { mailboxes });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      setBulkMailboxRows([]);
      setBulkMailboxErrors([]);
      setBulkMailboxFileName("");
      if (bulkMailboxInputRef.current) bulkMailboxInputRef.current.value = "";
      toast({
        title: "Bulk Import Complete",
        description: `${result.imported || 0} imported, ${result.skipped || 0} skipped, ${result.failed || 0} failed.`
      });
    },
    onError: (error: Error) => {
      let errorMsg = error.message;
      try {
        const jsonStr = error.message.replace(/^\d+:\s*/, '');
        const parsed = JSON.parse(jsonStr);
        errorMsg = parsed.details || parsed.error || errorMsg;
      } catch { }
      toast({ title: "Bulk Import Failed", description: errorMsg, variant: "destructive" });
    }
  });

  const disconnectCustomEmailMutation = useMutation({
    mutationFn: async (integrationId?: string) => apiRequest("POST", "/api/custom-email/disconnect", { integrationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({ title: "Email Disconnected" });
    }
  });

  const sendTestEmailMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/custom-email/send-test", {
        recipientEmail: data.recipient,
        subject: data.subject,
        content: data.content
      });
      return res.json();
    },
    onSuccess: () => {
      setIsTestEmailOpen(false);
      toast({ title: "Test Email Sent", description: "Check your inbox." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Send", description: err.message, variant: "destructive" });
    }
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/custom-email/sync-now"),
    onSuccess: () => {
      toast({ title: "Sync Triggered", description: "Fetching new messages in the background..." });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats", { integrationId: selectedMailboxId }] });
    },
    onError: (err: any) => toast({ title: "Sync Failed", description: err.message, variant: "destructive" })
  });

  const uploadVoiceMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("voice", file);
      const response = await fetch("/api/uploads/voice", { method: "POST", body: formData });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Voice Uploaded", description: "Your voice sample has been processed." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
    },
    onError: () => toast({ title: "Upload Failed", variant: "destructive" })
  });

  const handleConnect = async (provider: string) => {
    if (isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise') {
      toast({ 
        title: "Limit Reached", 
        description: "You've reached the mailbox limit for your plan. Please upgrade to add more.",
        variant: "destructive" 
      });
      return;
    }

    try {
      const response = await fetch(`/api/oauth/connect/${provider}`);
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText.substring(0, 50));
      }
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else throw new Error(data.error || "No auth URL returned");
    } catch (e: any) {
      console.error(e);
      toast({ title: "Error", description: `Could not start connection setup: ${e.message}`, variant: "destructive" });
    }
  };

  const discoverSettingsMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/custom-email/discover", { email });
      return res.json();
    },
    onSuccess: (data) => {
      setCustomEmailConfig(prev => {
        const next = { ...prev };
        if (data.smtp?.host) {
          next.smtpHost = data.smtp.host;
          next.smtpPort = String(data.smtp.port || 587);
          next.imapHost = data.imap?.host || prev.imapHost;
          next.imapPort = String(data.imap?.port || 993);
        }
        if (data.suggestedName && !prev.fromName) {
          next.fromName = data.suggestedName;
        }
        return next;
      });
      
      if (data.appPasswordGuide) {
        setAppPasswordGuide(data.appPasswordGuide);
      } else {
        setAppPasswordGuide(null);
      }

      if (data.smtp?.host) {
        toast({ title: "Settings Found", description: `Automatically detected settings for ${customEmailConfig.email}` });
      }
    }
  });

  const handleVoiceFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingVoice(true);
    try {
      await uploadVoiceMutation.mutateAsync(file);
    } finally {
      setIsUploadingVoice(false);
    }
  };

  const handleBulkMailboxFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const content = await file.text();
    const parsed = parseBulkMailboxFile(content);
    setBulkMailboxFileName(file.name);
    setBulkMailboxRows(parsed.rows.slice(0, 1000));
    setBulkMailboxErrors(parsed.rows.length > 1000
      ? [...parsed.errors, "Only the first 1,000 mailbox rows will be imported."]
      : parsed.errors
    );
  };

  const confirmDisconnect = (provider: string, integrationId?: string) => {
    setDisconnectProvider(provider === 'custom_email' ? (integrationId || 'custom_email') : provider);
    setDisconnectIntegrationId(integrationId || null);
    setIsDisconnectDialogOpen(true);
  };

  const getDomainFromEmail = (email: string | null) => {
    if (!email) return null;
    return email.split('@')[1];
  };

  const getMailboxLimit = () => {
    const planId = getActivePlanId(userData);
    const capabilities = getPlanCapabilities(planId);
    return capabilities.mailboxLimit;
  };

  const connectedMailboxesCount = useMemo(() =>
    (customEmailStatus?.integrations?.length || 0) +
    (integrations.filter((i: any) => i.provider === 'gmail' || i.provider === 'outlook').length || 0)
  , [customEmailStatus, integrations]);

  const limit = getMailboxLimit();
  const isAtMailboxLimit = limit !== -1 && connectedMailboxesCount >= limit;

  const getNextPlan = () => {
    const tier = getActivePlanId(userData);
    if (tier === 'starter') return 'Pro';
    if (tier === 'pro') return 'Enterprise';
    return null;
  };

  return (
    <PageWrapper className="space-y-8">
      <DisconnectConfirmationDialog
        isOpen={isDisconnectDialogOpen}
        onOpenChange={setIsDisconnectDialogOpen}
        onConfirm={() => {
          if (disconnectProvider === 'instagram' || disconnectProvider === 'gmail' || disconnectProvider === 'outlook' || disconnectProvider === 'calendly') {
            disconnectProviderMutation.mutate({ provider: disconnectProvider, integrationId: disconnectIntegrationId || undefined });
          } else if (disconnectProvider) {
            // It's a custom email integration ID
            disconnectCustomEmailMutation.mutate(disconnectProvider);
          }
        }}
        providerName={disconnectProvider === 'instagram' ? 'Instagram' :
          disconnectProvider === 'gmail' ? 
            (customEmailStatus?.integrations?.find(i => i.id === disconnectIntegrationId)?.email?.endsWith('@gmail.com') ? 'Personal Google Account' : 'Google Workspace') :
            disconnectProvider === 'outlook' ? 'Outlook' :
              customEmailStatus?.integrations?.find(i => i.id === disconnectProvider)?.email || 'Email Account'}
      />

      {/* Send Test Email Dialog */}
      <Dialog open={isTestEmailOpen} onOpenChange={setIsTestEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>Verify your SMTP connection by sending a real email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Recipient</Label>
              <Input
                placeholder="recipient@example.com"
                value={testEmailData.recipient}
                onChange={e => setTestEmailData({ ...testEmailData, recipient: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder="Test Subject"
                value={testEmailData.subject}
                onChange={e => setTestEmailData({ ...testEmailData, subject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Input
                placeholder="Hello world..."
                value={testEmailData.content}
                onChange={e => setTestEmailData({ ...testEmailData, content: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTestEmailOpen(false)}>Cancel</Button>
            <Button onClick={() => sendTestEmailMutation.mutate(testEmailData)} disabled={sendTestEmailMutation.isPending}>
              {sendTestEmailMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Integrations
          </h1>
          <p className="text-muted-foreground">
            Connect your favorite tools to automate your sales workflow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="rounded-full px-6 text-sm font-medium">
            <FileText className="mr-2 h-4 w-4" /> Documentation
          </Button>
          <Button className="rounded-full px-6 text-sm font-medium">
            <Plus className="mr-2 h-4 w-4" /> Request App
          </Button>
        </div>
      </div>

      <Tabs defaultValue="connected" className="w-full">
        <TabsList className="bg-muted/50 p-1 rounded-full w-full max-w-[400px] mb-8">
          <TabsTrigger value="connected" className="rounded-full px-8 py-2 text-sm font-medium">
            Channels
          </TabsTrigger>
          <TabsTrigger value="voice" className="rounded-full px-8 py-2 text-sm font-medium">
            Voice Cloning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connected" className="space-y-12">
          {/* Custom SMTP Integration Section */}
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                  <Mail className="h-5 w-5" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">Custom Email Domain</h2>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <Badge variant="outline" className={cn(
                  "rounded-full px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-widest border-border/50 bg-muted/20",
                  getActivePlanId(userData) === 'enterprise' ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5" : "text-muted-foreground"
                )}>
                  {connectedMailboxesCount} / {limit === -1 ? '∞' : limit}
                </Badge>
                <Badge variant="outline" className="rounded-full px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest border-primary/20 bg-primary/5 text-primary">
                  Advanced
                </Badge>
              </div>
            </div>

            <Card className={cn(
              "rounded-3xl border-border/50 overflow-hidden transition-all duration-500",
              hasMailboxesConnected || isEditingCustomEmail ? "bg-card shadow-2xl shadow-primary/5 border-primary/20" : "bg-muted/20"
            )}>
              {isEditingCustomEmail ? (
                <div className="p-8 space-y-6">
                  <div className="flex items-center justify-between mb-6">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setIsEditingCustomEmail(false)}
                      className="rounded-full text-xs font-bold gap-2 hover:bg-primary/5"
                    >
                      <ArrowRight className="h-4 w-4 rotate-180" /> Back to Mailboxes
                    </Button>
                    {isAtMailboxLimit && (
                       <Badge variant="outline" className="rounded-full text-[10px] text-amber-500 border-amber-500/20 bg-amber-500/5 px-3 py-1">
                        <AlertCircle className="h-3 w-3 mr-1" /> Plan Limit Reached
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">
                        Connect New Mailbox
                      </h3>
                      <p className="text-xs text-muted-foreground">Select your provider to connect your business email for automated outreach.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        className={cn(
                          "rounded-xl px-4 py-6 transition-all flex flex-col items-center gap-2 flex-1 min-w-0 sm:min-w-[140px]",
                          isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise' 
                            ? "opacity-50 cursor-not-allowed border-muted bg-muted/20" 
                            : "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                        )}
                        onClick={() => handleConnect('gmail')}
                        disabled={isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise'}
                      >
                        <SiGoogle className="h-5 w-5 shrink-0" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Connect Google</span>
                      </Button>

                      <Button
                        variant="outline"
                        className={cn(
                          "rounded-xl px-4 py-6 transition-all flex flex-col items-center gap-2 flex-1 min-w-0 sm:min-w-[140px]",
                          isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise'
                            ? "opacity-50 cursor-not-allowed border-muted bg-muted/20"
                            : "border-blue-500/20 bg-blue-500/5 text-blue-500 hover:bg-blue-500/10"
                        )}
                        onClick={() => handleConnect('outlook')}
                        disabled={isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise'}
                      >
                        <Mail className="h-5 w-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Connect Outlook</span>
                      </Button>

                      <div className="w-full md:w-auto flex flex-col items-center justify-center px-4">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">Or</span>
                      </div>

                      <Button
                        variant="outline"
                        className="rounded-xl px-4 py-6 border-border/50 bg-muted/20 text-foreground hover:bg-muted/30 transition-all flex flex-col items-center gap-2 flex-1 min-w-0 sm:min-w-[140px]"
                        onClick={() => {
                          setCustomEmailConfig({ smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993', email: '', password: '', fromName: '' });
                        }}
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Custom SMTP</span>
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Upload className="h-4 w-4 text-emerald-500" />
                          <h4 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
                            Enterprise Bulk Import
                          </h4>
                        </div>
                        <p className="text-xs text-muted-foreground break-words">
                          Upload CSV or TSV with email, password, smtpHost, smtpPort, imapHost, imapPort, and fromName columns.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          ref={bulkMailboxInputRef}
                          type="file"
                          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                          className="hidden"
                          onChange={handleBulkMailboxFileSelect}
                        />
                        <Button
                          variant="outline"
                          className="rounded-xl gap-2"
                          disabled={getActivePlanId(userData) !== 'enterprise' || bulkMailboxImportMutation.isPending}
                          onClick={() => bulkMailboxInputRef.current?.click()}
                        >
                          <FileText className="h-4 w-4" />
                          Choose File
                        </Button>
                        <Button
                          className="rounded-xl gap-2 bg-emerald-600 hover:bg-emerald-700"
                          disabled={getActivePlanId(userData) !== 'enterprise' || bulkMailboxRows.length === 0 || bulkMailboxImportMutation.isPending}
                          onClick={() => bulkMailboxImportMutation.mutate(bulkMailboxRows)}
                        >
                          {bulkMailboxImportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          Import {bulkMailboxRows.length || ''} Mailboxes
                        </Button>
                      </div>
                    </div>

                    {getActivePlanId(userData) !== 'enterprise' && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Bulk mailbox import is available on the enterprise plan.
                      </p>
                    )}

                    {(bulkMailboxFileName || bulkMailboxErrors.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                          <p className="font-bold text-foreground">File</p>
                          <p className="text-muted-foreground truncate">{bulkMailboxFileName || "No file selected"}</p>
                        </div>
                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                          <p className="font-bold text-foreground">Ready Rows</p>
                          <p className="text-muted-foreground">{bulkMailboxRows.length}</p>
                        </div>
                        <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                          <p className="font-bold text-foreground">Parser Errors</p>
                          <p className="text-muted-foreground">{bulkMailboxErrors.length}</p>
                        </div>
                      </div>
                    )}

                    {bulkMailboxErrors.length > 0 && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-2">
                          Rows Needing Attention
                        </p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {bulkMailboxErrors.slice(0, 5).map((error, index) => (
                            <li key={`${error}-${index}`}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border/40">
                    <div className="md:col-span-2">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-4">Manual SMTP Configuration</h4>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs font-semibold text-muted-foreground ml-1">Account Email</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="your@email.com"
                          value={customEmailConfig.email}
                          onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, email: e.target.value })}
                          onBlur={() => {
                            if (customEmailConfig.email.includes('@') && customEmailConfig.email.includes('.')) {
                              discoverSettingsMutation.mutate(customEmailConfig.email);
                            }
                          }}
                          className="rounded-xl border-border/50 focus:ring-primary/20"
                        />
                        <Button
                          variant="outline"
                          className="rounded-xl px-4 text-xs font-bold gap-2"
                          onClick={() => discoverSettingsMutation.mutate(customEmailConfig.email)}
                          disabled={!customEmailConfig.email.includes('@') || discoverSettingsMutation.isPending}
                        >
                          {discoverSettingsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {discoverSettingsMutation.isPending ? "Discovering..." : "Auto-Discover"}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">Display Name</Label>
                        <Input
                          placeholder="John Doe"
                          value={customEmailConfig.fromName}
                          onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, fromName: e.target.value })}
                          className="rounded-xl border-border/50 focus:ring-primary/20"
                        />
                      </div>

                      {/* Dynamic App Password Guide — CSS max-height transition (no JS layout measurement = no mobile blink) */}
                      <div
                        className={cn(
                          "md:col-span-2 overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out",
                          appPasswordGuide ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                        )}
                      >
                        {appPasswordGuide && (
                          <div className="p-5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-4">
                              <div className="flex items-start gap-4">
                                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
                                  <ShieldCheck className="h-5 w-5" />
                                </div>
                                <div className="space-y-1">
                                  <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                                    {appPasswordGuide.provider} Security Guide
                                    <Badge className="bg-indigo-500/10 text-indigo-500 border-0 text-[9px] font-black tracking-widest px-1.5 py-0">Required for 2FA</Badge>
                                  </h4>
                                  <p className="text-xs text-muted-foreground leading-relaxed">{appPasswordGuide.instructions}</p>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-12">
                                <div className="space-y-3">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Setup Steps</p>
                                  <div className="space-y-2">
                                    {appPasswordGuide.steps.map((step: string, idx: number) => (
                                      <div key={idx} className="flex gap-3">
                                        <div className="h-4 w-4 rounded-full bg-indigo-500/10 flex items-center justify-center text-[8px] font-bold text-indigo-500 mt-0.5 shrink-0">{idx + 1}</div>
                                        <p className="text-[10px] text-muted-foreground leading-tight">{step}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex flex-col justify-end gap-3">
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="rounded-xl border-indigo-500/20 text-indigo-500 hover:bg-indigo-500/10 text-[10px] font-black uppercase tracking-widest h-9"
                                    onClick={() => window.open(appPasswordGuide.link, '_blank')}
                                  >
                                    Open {appPasswordGuide.provider} Security Settings <ArrowRight className="ml-2 h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                        )}
                      </div>
                    
                    {[
                      { label: "SMTP Host", key: "smtpHost", placeholder: "e.g. smtp.gmail.com" },
                      { label: "SMTP Port", key: "smtpPort", placeholder: "587" },
                    ].map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">{field.label}</Label>
                        <Input
                          placeholder={field.placeholder}
                          value={(customEmailConfig as any)[field.key]}
                          onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, [field.key]: e.target.value })}
                          className="rounded-xl border-border/50 focus:ring-primary/20"
                        />
                      </div>
                    ))}

                    {/* Password field with toggle */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground ml-1 flex items-center gap-1.5">
                        {passwordType === 'app_password' ? 'App Password' : 'Mailbox Password'}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertCircle className="h-3 w-3 text-primary animate-pulse cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[280px] p-4 space-y-3 bg-indigo-950/90 border-primary/20 backdrop-blur-xl">
                              <div className="space-y-1">
                                <p className="font-black text-[10px] uppercase tracking-widest text-primary flex items-center gap-2">
                                  <Sparkles className="h-3 w-3" /> {passwordType === 'app_password' ? 'App Password Guide' : 'Mailbox Password Guide'}
                                </p>
                                <p className="text-xs leading-relaxed text-foreground/90 italic">
                                  {passwordType === 'app_password'
                                    ? 'Manual connection for personal accounts requires a 16-character <strong>App Password</strong>.'
                                    : 'Use your regular mailbox password (or app password if 2FA is enabled).'}
                                </p>
                              </div>
                              {passwordType === 'app_password' ? (
                                <>
                                  <div className="space-y-2 py-1">
                                    <div className="flex items-start gap-2">
                                      <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary mt-0.5 shrink-0">1</div>
                                      <p className="text-[10px] text-muted-foreground">Enable <strong>IMAP Access</strong> in your email Forwarding/IMAP settings.</p>
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary mt-0.5 shrink-0">2</div>
                                      <p className="text-[10px] text-muted-foreground">Enable <strong>2-Step Verification</strong> in Security settings.</p>
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary mt-0.5 shrink-0">3</div>
                                      <p className="text-[10px] text-muted-foreground">Search for <strong>"App Passwords"</strong> and generate a code.</p>
                                    </div>
                                  </div>
                                  <div className="pt-2 border-t border-white/5 space-y-2">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-orange-500/60">Getting Connection Error?</p>
                                    <p className="text-[10px] text-muted-foreground leading-snug">Ensure <strong>IMAP</strong> is set to "Enabled" in your email provider. Your regular password will not work.</p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    className="p-0 h-auto text-[10px] font-black uppercase tracking-widest text-primary hover:text-primary/80 hover:bg-transparent"
                                    onClick={() => window.open('https://myaccount.google.com/apppasswords', '_blank')}
                                  >
                                    Open Google Settings <ArrowRight className="ml-1 h-3 w-3" />
                                  </Button>
                                </>
                              ) : (
                                <p className="text-[10px] text-muted-foreground leading-snug">
                                  Use the same password you use to log into your email account. Some providers (Gmail, Outlook with 2FA) may still require an <strong>App Password</strong> — switch to App Password mode if connection fails.
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                      <Input
                        type="password"
                        placeholder={passwordType === 'app_password' ? "Minimum 16 characters" : "Your mailbox password"}
                        value={customEmailConfig.password}
                        onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, password: e.target.value })}
                        className="rounded-xl border-border/50 focus:ring-primary/20"
                      />
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => setPasswordType(passwordType === 'app_password' ? 'mailbox_password' : 'app_password')}
                          className="text-[10px] font-bold tracking-wide underline underline-offset-2 decoration-dotted transition-colors"
                        >
                          <span className={passwordType === 'mailbox_password' ? 'text-primary' : 'text-muted-foreground hover:text-primary'}>
                            {passwordType === 'app_password' ? 'Use Mailbox Password' : 'Use App Password'}
                          </span>
                        </button>
                        {appPasswordGuide && passwordType === 'app_password' && (
                          <span className="text-[9px] text-indigo-500 font-bold uppercase tracking-widest bg-indigo-500/10 px-1.5 py-0.5 rounded-full ml-auto">
                            Recommended
                          </span>
                        )}
                        {passwordType === 'mailbox_password' && (
                          <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-widest bg-emerald-500/10 px-1.5 py-0.5 rounded-full ml-auto">
                            Default
                          </span>
                        )}
                      </div>
                    </div>

                    {[
                      { label: "IMAP Host (Optional)", key: "imapHost", placeholder: "e.g. imap.gmail.com" },
                      { label: "IMAP Port", key: "imapPort", placeholder: "993" }
                    ].map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">{field.label}</Label>
                        <Input
                          placeholder={field.placeholder}
                          value={(customEmailConfig as any)[field.key]}
                          onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, [field.key]: e.target.value })}
                          className="rounded-xl border-border/50 focus:ring-primary/20"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button
                      className="rounded-xl px-8 font-semibold h-11 flex-1"
                      disabled={connectCustomEmailMutation.isPending || (isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise')}
                      onClick={() => connectCustomEmailMutation.mutate({ ...customEmailConfig, passwordType })}
                    >
                      {connectCustomEmailMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise' ? 'Limit Reached' : 'Add Mailbox'}
                    </Button>
                    <Button variant="outline" className="rounded-xl px-8 font-semibold h-11" onClick={() => setIsEditingCustomEmail(false)}>Cancel</Button>
                  </div>
                </div>
              ) : hasMailboxesConnected ? (
                <div className="p-8 space-y-8">
                  <div className="flex items-center justify-between pb-4 border-b border-border/50">
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-foreground">Active Business Mailboxes</h3>
                          <Badge variant="outline" className={cn(
                            "rounded-full text-[10px] font-black tracking-widest px-2",
                            getActivePlanId(userData) === 'enterprise' 
                              ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5 shadow-inner" 
                              : isAtMailboxLimit 
                                ? "text-amber-500 border-amber-500/20 bg-amber-500/5"
                                : "text-primary border-primary/20 bg-primary/5"
                          )}>
                            {getActivePlanId(userData) === 'enterprise' ? "∞ UNLIMITED" : `${connectedMailboxesCount} / ${limit}`}
                          </Badge>
                        </div>
                        {limit !== -1 && (
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                            {Math.round((connectedMailboxesCount / limit) * 100)}% Capacity
                          </span>
                        )}
                      </div>
                      
                      {limit !== -1 ? (
                        <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden border border-border/5">
                           <motion.div 
                             initial={{ width: 0 }}
                             animate={{ width: `${Math.min((connectedMailboxesCount / limit) * 100, 100)}%` }}
                             transition={{ duration: 1, ease: "easeOut" }}
                             className={cn(
                               "h-full rounded-full",
                               isAtMailboxLimit ? "bg-amber-500" : "bg-primary"
                             )}
                           />
                        </div>
                      ) : (
                        <div className="h-1.5 w-full bg-emerald-500/10 rounded-full overflow-hidden border border-emerald-500/5">
                           <motion.div 
                             initial={{ width: 0 }}
                             animate={{ width: "100%" }}
                             transition={{ duration: 1.5, ease: "easeOut" }}
                             className="h-full bg-gradient-to-r from-emerald-500/40 via-emerald-500 to-emerald-500/40 bg-[length:200%_100%] animate-shimmer"
                           />
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground italic">
                        {getActivePlanId(userData) === 'enterprise'
                          ? "Enterprise Tier: Scalable mailbox architecture enabled with no connection limits."
                          : isAtMailboxLimit
                            ? "Limit reached. Upgrade or disconnect a mailbox to add more."
                            : `You have ${limit - connectedMailboxesCount} mailbox slots remaining on your ${getActivePlanId(userData)} plan.`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {getActivePlanId(userData) !== 'enterprise' && isAtMailboxLimit && getNextPlan() && (
                        <Link href="/dashboard/pricing">
                          <Button size="sm" variant="outline" className="rounded-full gap-2 border-primary/20 text-primary hover:bg-primary/5">
                            <Zap className="h-3.5 w-3.5 fill-primary" /> Upgrade for More
                          </Button>
                        </Link>
                      )}
                      
                      <Button
                        size="sm"
                        className="rounded-full gap-2 shadow-lg shadow-primary/20"
                        onClick={() => setIsEditingCustomEmail(true)}
                        variant={isAtMailboxLimit ? "outline" : "default"}
                      >
                        <Plus className="h-4 w-4" /> Add Mailbox
                      </Button>

                      {getActivePlanId(userData) === 'enterprise' && (
                        <Badge variant="outline" className="rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 border-emerald-500/30 bg-emerald-500/10 shadow-lg shadow-emerald-500/10">
                          Enterprise Elite
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {allMailboxes.length > 5 && (
                      <div className="flex items-center gap-3 mb-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder={`Search ${allMailboxes.length} mailboxes...`}
                            value={mailboxSearch}
                            onChange={e => { setMailboxSearch(e.target.value); resetMailboxPagination(); }}
                            className="h-9 pl-9 rounded-xl text-xs border-border/40 bg-muted/20"
                          />
                        </div>
                        {mailboxSearch && (
                          <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">
                            {filteredMailboxes.length} found
                          </span>
                        )}
                      </div>
                    )}
                    {pagedMailboxes.map((mailbox) => (
                      <div key={mailbox.id} className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 sm:p-6 rounded-xl sm:rounded-2xl bg-muted/20 border border-border/40 hover:border-primary/30 transition-all group">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className={cn(
                            "h-8 w-8 sm:h-12 sm:w-12 rounded-lg sm:rounded-xl flex items-center justify-center border transition-all duration-300 shrink-0",
                            !mailbox.connected ? "bg-muted/10 border-dashed border-muted grayscale" :
                            mailbox.provider === 'gmail' ? "bg-red-500/10 border-red-500/20 text-red-500" :
                            mailbox.provider === 'outlook' ? "bg-blue-500/10 border-blue-500/20 text-blue-500" :
                            "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                          )}>
                            {mailbox.provider === 'gmail' ? <SiGoogle className="h-4 sm:h-6 w-4 sm:w-6" /> :
                             mailbox.provider === 'outlook' ? <Mail className="h-4 sm:h-6 w-4 sm:w-6" /> :
                             <CheckCircle2 className="h-4 sm:h-6 w-4 sm:w-6" />}
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h4 className={cn("text-xs sm:text-sm font-bold transition-colors truncate max-w-[120px] sm:max-w-xs", !mailbox.connected ? "text-muted-foreground" : "text-foreground")}>
                                {mailbox.email}
                              </h4>
                              {mailbox.connected ? (
                                <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[7px] sm:text-[8px] font-black uppercase tracking-widest px-1 py-0 shrink-0">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground border-muted text-[7px] sm:text-[8px] font-black uppercase tracking-widest px-1 py-0 shrink-0">Disconnected</Badge>
                              )}
                              {/* DNS badges — hidden on mobile to save space */}
                              {mailbox.connected && stats?.health?.dns && (
                                <span className="hidden sm:inline-flex gap-1.5">
                                  <Badge className={cn(
                                    "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 shrink-0 border",
                                    stats.health.dns.spf ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                  )}>
                                    SPF
                                  </Badge>
                                  <Badge className={cn(
                                    "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 shrink-0 border",
                                    stats.health.dns.dkim ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                  )}>
                                    DKIM
                                  </Badge>
                                  <Badge className={cn(
                                    "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 shrink-0 border",
                                    stats.health.dns.dmarc ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                  )}>
                                    DMARC
                                  </Badge>
                                  <Badge className={cn(
                                    "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 shrink-0 border",
                                    stats.health.dns.mx ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                  )}>
                                    MX
                                  </Badge>
                                  <Badge className={cn(
                                    "text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 shrink-0 border",
                                    !stats.health.dns.blacklist ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                  )}>
                                    RBL
                                  </Badge>
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] sm:text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">
                              {mailbox.provider === 'gmail' ? (mailbox.email?.endsWith('@gmail.com') ? "Personal Google Account" : "Google Workspace") :
                               mailbox.provider === 'outlook' ? "Outlook / Office 365" :
                               "Custom SMTP Account"}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 mt-2 lg:mt-0">
                          {mailbox.connected && (
                            <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-background/50 rounded-xl border border-border/50 w-full sm:w-auto max-sm:hidden">
                              <div className="flex flex-col justify-center">
                                <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reputation</span>
                                <span className={cn(
                                  "text-xs sm:text-sm font-black",
                                  mailbox.reputationScore === null || mailbox.reputationScore === undefined ? "text-sky-500" :
                                  mailbox.reputationScore >= 80 ? "text-emerald-500" :
                                  mailbox.reputationScore >= 50 ? "text-amber-500" : "text-destructive"
                                )}>
                                  {mailbox.reputationScore !== undefined && mailbox.reputationScore !== null 
                                    ? `${mailbox.reputationScore}/100` 
                                    : "Init..."}
                                </span>
                              </div>
                              <div className="flex flex-col justify-center border-l border-border/40 pl-2">
                                <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bounce</span>
                                <span className={cn(
                                  "text-xs sm:text-sm font-black",
                                  mailbox.bounceRate === null || mailbox.bounceRate === undefined ? "text-sky-500" :
                                  ((mailbox.bounceRate ?? 0) * 100) < 2 ? "text-emerald-500" :
                                  ((mailbox.bounceRate ?? 0) * 100) < 5 ? "text-amber-500" : "text-destructive"
                                )}>
                                  {mailbox.bounceRate !== undefined && mailbox.bounceRate !== null
                                    ? `${((mailbox.bounceRate ?? 0) * 100).toFixed(1)}%`
                                    : "Init..."}
                                </span>
                              </div>
                              <div className="flex flex-col justify-center border-l border-border/40 pl-3 min-w-[90px]">
                                <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</span>
                                <span className="text-xs font-black text-emerald-400 tabular-nums">
                                  {mailbox.connected ? "Active" : "Inactive"}
                                </span>
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2 w-full sm:w-auto">
                            {mailbox.connected && (
                              <Button variant="outline" size="sm" className="h-8 rounded-lg text-[9px] sm:text-[10px] px-2.5 flex-1 sm:flex-initial" onClick={() => setIsTestEmailOpen(true)}>
                                <Mail className="h-3 w-3 mr-1" /> Test
                              </Button>
                            )}
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 rounded-lg text-[9px] sm:text-[10px] px-2.5 font-bold text-destructive hover:bg-destructive/10 flex-1 sm:flex-initial" 
                              onClick={() => confirmDisconnect(mailbox.provider, mailbox.id)}
                            >
                              <Unplug className="h-3 w-3 mr-1" /> {mailbox.connected ? "Disconnect" : "Remove"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* View More / View Less toggle — shown when there are > 5 mailboxes and no active search */}
                    {!mailboxSearch.trim() && allMailboxes.length > INITIAL_VISIBLE && (
                      <button
                        onClick={() => setShowAllMailboxes(v => !v)}
                        className="w-full mt-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] text-primary/70 hover:text-primary hover:bg-primary/5 transition-all border border-dashed border-primary/20 hover:border-primary/40"
                      >
                        {showAllMailboxes
                          ? `∧  Show fewer mailboxes`
                          : `∨  View all ${allMailboxes.length} mailboxes (+${allMailboxes.length - INITIAL_VISIBLE} more)`}
                      </button>
                    )}

                    {totalMailboxPages > 1 && showAllMailboxes && (
                      <div className="flex items-center justify-between pt-2 border-t border-border/20">
                        <span className="text-[10px] font-bold text-muted-foreground">
                          Showing {mailboxPage * MAILBOXES_PER_PAGE + 1}–{Math.min((mailboxPage + 1) * MAILBOXES_PER_PAGE, filteredMailboxes.length)} of {filteredMailboxes.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 rounded-lg"
                            disabled={mailboxPage === 0}
                            onClick={() => setMailboxPage(p => p - 1)}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="text-[10px] font-bold text-muted-foreground">
                            {mailboxPage + 1} / {totalMailboxPages}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 rounded-lg"
                            disabled={mailboxPage >= totalMailboxPages - 1}
                            onClick={() => setMailboxPage(p => p + 1)}
                          >
                            <ChevronRightIcon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                    <div className="flex items-center justify-around p-6 rounded-2xl bg-muted/20 border border-border/40 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 bg-primary rounded-full" />
                      <CircularProgress
                        value={stats?.messagesToday ? (stats.messagesToday / getDailyLimit()) * 100 : 0}
                        label={stats ? (stats.messagesToday || "0") : "..."}
                        sublabel="Sent Today"
                      />
                      <CircularProgress
                        value={stats?.messagesYesterday ? (stats.messagesYesterday / getDailyLimit()) * 100 : 0}
                        label={stats ? (stats.messagesYesterday || "0") : "..."}
                        sublabel="Sent Yesterday"
                        color="secondary"
                      />
                      <div className="absolute bottom-3 right-4 flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Autonomous Sync Online</span>
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Activity className="w-3 h-3 text-muted-foreground/40" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-[10px] font-bold">24/7 Reputation Worker is active.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>

                    <div className="p-6 rounded-2xl bg-muted/20 border border-border/40 space-y-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <h3 className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-primary" />
                            Domain Health Monitor
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            onClick={() => {
                              const targetEmail = selectedMailboxId && allMailboxes.find(i => i.id === selectedMailboxId)?.email
                                ? allMailboxes.find(i => i.id === selectedMailboxId)!.email
                                : allMailboxes[0]?.email;
                              const domain = getDomainFromEmail(targetEmail || null);
                              if (domain) verifyDomainMutation.mutate(domain);
                            }}
                            disabled={verifyDomainMutation.isPending}
                          >
                            <RefreshCw className={cn("h-3 w-3", verifyDomainMutation.isPending && "animate-spin")} />
                          </Button>
                          <Badge className={cn(
                            "text-[9px] font-black border-0 uppercase tracking-tighter",
                            !(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? "bg-muted text-muted-foreground" :
                            reputationNum === null ? "bg-muted text-muted-foreground" :
                              reputationNum >= 70 ? "bg-emerald-500/10 text-emerald-500" : 
                              reputationNum >= 55 ? "bg-amber-500/10 text-amber-500" :
                              reputationNum >= 40 ? "bg-orange-500/10 text-orange-500" : "bg-red-500/10 text-red-500"
                          )}>
                            {!(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? "Inactive" :
                             reputationNum === null ? "Pending Analysis" : 
                              reputationNum >= 70 ? "Healthy" : 
                              reputationNum >= 55 ? "Attention Required" : 
                              reputationNum >= 40 ? "Cautious" : "Unhealthy - Reduced to 5/day"}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Domain Grade</p>
                          <div className="text-3xl font-black tracking-tighter text-foreground h-9 flex items-center gap-2">
                            {!(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? (
                              "0.00%"
                            ) : reputationStr !== null ? (
                              <>
                                {reputationStr}%
                                {reputationNum === 100 && (
                                  <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[7px] font-black uppercase tracking-widest px-1 py-0 h-3">Verified</Badge>
                                )}
                              </>
                            ) : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Engine Status</p>
                          <p className={cn(
                            "text-xs font-black uppercase tracking-widest pt-2",
                            !(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? "text-muted-foreground" :
                            reputationNum === null ? "text-muted-foreground" :
                              reputationNum >= 70 ? "text-emerald-500" : 
                              reputationNum >= 40 ? "text-orange-500" : "text-red-500"
                          )}>
                            {!(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? "Offline" :
                             reputationNum === null ? "Waiting" : reputationNum >= 70 ? "Autonomous" : "User Oversight Recommended"}
                          </p>
                        </div>
                      </div>

                      <div className={cn(
                        "p-3 rounded-xl border text-[10px] leading-tight font-medium transition-all duration-300",
                        !(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? "bg-muted/10 border-border/20 text-muted-foreground" :
                        reputationNum === null ? "bg-muted/10 border-border/20 text-muted-foreground" :
                          reputationNum >= 70
                            ? "bg-primary/5 border-primary/10 text-muted-foreground"
                            : reputationNum >= 40
                            ? "bg-orange-500/5 border-orange-500/10 text-orange-400"
                            : "bg-red-500/5 border-red-500/10 text-red-400"
                      )}>
                        <span className="break-words">
                          {!(customEmailStatus?.integrations && customEmailStatus.integrations.length > 0) ? "Please connect a mailbox to initiate domain health monitoring." :
                           reputationNum === null ? "AI is initiating a health checkpoint for your domain." :
                           reputationNum >= 70
                                ? "Your domain parameters are within safe limits."
                                : reputationNum >= 40
                                ? "Advisory: Minor reputation dip detected. Warmup volume adjusted to protect domain health."
                                : "Critical: Low reputation detected. Warmup volume reduced to minimum."}
                        </span>
                      </div>

                      {stats?.domainVerifications?.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Recent DNS Checks</p>
                          <div className="space-y-1.5">
                            {stats.domainVerifications.map((v: any, idx: number) => (
                              <div key={idx} className="flex flex-col gap-1.5 bg-white/5 p-3 rounded-xl border border-border/50">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-foreground/80">{v.domain}</span>
                                  <Badge className={cn(
                                    "text-[8px] h-4 py-0 uppercase font-black",
                                    v.result?.overallStatus === 'excellent' || v.result?.overallStatus === 'good' || v.result?.overallStatus === 'fair' ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                                  )}>
                                    {v.result?.overallStatus || 'Pending'}
                                  </Badge>
                                </div>
                                {v.result && (
                                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                                    {['SPF', 'DKIM', 'DMARC', 'MX', 'BLACKLIST'].map(record => {
                                      const key = record === 'BLACKLIST' ? 'blacklist' : record.toLowerCase();
                                      const rec = v.result[key];
                                      if (record === 'BLACKLIST') {
                                        const isBlacklisted = rec?.isBlacklisted || rec?.listedOn?.length > 0;
                                        return (
                                          <div key={record} className="flex flex-col items-center gap-1 p-1 rounded bg-black/20">
                                            <span className="text-[7px] font-bold text-muted-foreground uppercase">BL</span>
                                            <div className={cn("h-1 w-full rounded-full", isBlacklisted ? "bg-red-500" : "bg-emerald-500")} />
                                          </div>
                                        );
                                      }
                                      const isFound = rec?.found;
                                      const isValid = rec?.valid ?? true;
                                      return (
                                        <div key={record} className="flex flex-col items-center gap-1 p-1 rounded bg-black/20">
                                          <span className="text-[7px] font-bold text-muted-foreground uppercase">{record}</span>
                                          <div className={cn("h-1 w-full rounded-full", isFound && isValid ? "bg-emerald-500" : isFound ? "bg-amber-500" : "bg-red-500")} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-12">
                   <div className="flex flex-col items-center text-center space-y-6">
                    <div className="h-24 w-24 rounded-2xl bg-primary/5 flex items-center justify-center border border-primary/10 relative shadow-inner group">
                      <div className="absolute inset-0 bg-primary/5 blur-xl group-hover:bg-primary/10 transition-all rounded-full" />
                      <Mail className="h-10 w-10 text-primary relative z-10" />
                    </div>
                    <div className="space-y-2 max-w-sm">
                      <h3 className="text-xl font-bold tracking-tight">Connect Custom Domain</h3>
                      <p className="text-sm font-medium text-muted-foreground leading-relaxed px-4">Professional outreach requires a custom SMTP & IMAP connection for high deliverability.</p>
                    </div>
                    <Button 
                      className="rounded-xl gap-2 h-11 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider shadow-lg shadow-primary/15"
                      onClick={() => setIsEditingCustomEmail(true)}
                    >
                      <Plus className="h-4 w-4" /> Start Connecting
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Social and SaaS Integrations */}
            <ResponsiveGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {isLoading ? (
                // Skeleton loading for integration cards — count matches integrationCards.length
                Array.from({ length: integrationCards.length }).map((_, i) => (
                  <Card key={i} className="rounded-2xl border border-border/50 bg-muted/10 p-6 animate-pulse">
                    <div className="flex justify-between items-start mb-6">
                      <div className="h-14 w-14 rounded-xl bg-muted/20" />
                      <div className="h-4 w-12 rounded bg-muted/20" />
                    </div>
                    <div className="h-5 w-24 rounded bg-muted/20 mb-2" />
                    <div className="h-4 w-full rounded bg-muted/20" />
                    <div className="mt-6 h-9 w-full rounded-lg bg-muted/20" />
                  </Card>
                ))
              ) : (
                integrationCards.map((card) => {
                  const connectedIntegrations = Array.isArray(integrations) ? integrations.filter(i => i.provider === card.id) : [];
                  const isConnected = connectedIntegrations.length > 0;

                  return (
                    <Card key={card.id} className={`group transition-all rounded-2xl border bg-muted/10 hover:bg-muted/20 ${isConnected ? 'border-primary/40 bg-primary/5' : 'border-border/50'} flex flex-col`}>
                      <CardHeader className="p-6 flex-grow">
                        <div className="flex justify-between items-start mb-6">
                          <div className={`p-4 rounded-xl bg-background border border-border/50 ${card.color}`}>
                            <card.icon className="h-6 w-6" />
                          </div>
                          {card.badge ? (
                            <Badge variant="secondary" className="bg-muted text-muted-foreground border-0 font-semibold text-[9px] uppercase tracking-wider py-1">{card.badge}</Badge>
                          ) : isConnected ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-0 font-bold text-[9px] uppercase tracking-wider py-1">{connectedIntegrations.length} Active</Badge>
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-muted-foreground/20" />
                          )}
                        </div>
                        <CardTitle className="text-lg font-semibold">{card.name}</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">{card.description}</CardDescription>
                      </CardHeader>
                      <CardFooter className="p-6 pt-0 flex flex-col gap-3">
                        {isConnected && connectedIntegrations.slice(0, 3).map((integration, idx) => (
                          <div key={integration.id || `int-${idx}`} className="flex items-center justify-between w-full p-2 rounded bg-background/50 border border-border/30">
                            <span className="text-[10px] font-medium truncate max-w-[120px]" title={integration.accountType?.toString() || ""}>{integration.accountType || "Connected"}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10"
                              onClick={() => confirmDisconnect(card.id, (integration as any).id)}
                            >
                              Disconnect
                            </Button>
                          </div>
                        ))}
                        {connectedIntegrations.length > 3 && (
                          <div className="text-[10px] font-bold text-muted-foreground text-center py-0.5">
                            +{connectedIntegrations.length - 3} more connected
                          </div>
                        )}
                        
                        <Button
                          variant={card.badge ? "secondary" : (isConnected ? "outline" : "default")}
                          size="sm"
                          className="w-full rounded-lg text-xs font-semibold"
                          disabled={!!card.badge}
                          onClick={() => handleConnect(card.id)}
                        >
                          {card.badge ? card.badge : (isConnected ? "Connect Another" : "Connect Account")}
                        </Button>
                        {card.freePlanNote && (
                          <div className="flex items-start gap-1.5 px-1 mt-1">
                            <Info className="h-3 w-3 text-muted-foreground/60 mt-0.5 shrink-0" />
                            <p className="text-[10px] text-muted-foreground/70 leading-tight">
                              {card.freePlanNote}
                            </p>
                          </div>
                        )}
                      </CardFooter>
                    </Card>
                  );
                })
              )}
            </ResponsiveGrid>
          </div>
        </TabsContent >


        <TabsContent value="voice">
          <Card className="rounded-2xl border-border/50 overflow-hidden">
            <CardContent className="p-12 text-center">
              <div className="flex justify-center mb-6">
                <div className="p-4 rounded-full bg-muted">
                  <Construction className="w-12 h-12 text-muted-foreground" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-3">Coming Soon</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                AI Voice Cloning is being enhanced and will be available soon.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs >
    </PageWrapper>
  );
}
