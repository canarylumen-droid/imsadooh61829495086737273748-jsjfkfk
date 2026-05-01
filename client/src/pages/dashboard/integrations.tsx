import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useCanAccessVoiceNotes } from "@/hooks/use-access-gate";
import { useMailbox } from "@/hooks/use-mailbox";
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
  ArrowRight
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

const integrationCards: Array<{
  do: "social" | "calendar";
  id: string;
  name: string;
  description: string;
  icon: any;
  color: string;
  bg: string;
  badge?: string;
}> = [
  {
    do: "social",
    id: "instagram",
    name: "Instagram",
    description: "Automate DMs and lead responses on your Instagram account.",
    icon: Instagram,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    do: "calendar",
    id: "calendly",
    name: "Calendly",
    description: "AI-led appointment scheduling. Automatically book meetings with interested leads.",
    icon: RefreshCw,
    color: "text-blue-600",
    bg: "bg-blue-600/10",
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
  const [appPasswordGuide, setAppPasswordGuide] = useState<any>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  const { data: integrationsData, isLoading } = useQuery<IntegrationsResponse>({
    queryKey: ["/api/integrations"],
    placeholderData: (prev: any) => prev,
  });
  const { data: customEmailStatus, refetch: refetchStatus } = useQuery<{
    connected: boolean;
    email: string | null;
    integrations: Array<{ id: string; email: string; connected: boolean; provider: string; reputationScore?: number; bounceRate?: number }>;
  }>({
    queryKey: ["/api/custom-email/status"],
    placeholderData: (prev) => prev,
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

  const calculateReputation = () => {
    return stats?.domainHealth !== undefined ? stats.domainHealth.toFixed(2) : null;
  };

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

        // Robust re-fetch with slight delay to ensure backend propagation
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
        }, 1000);
      }
      
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }

    // 2. Autonomous check: if email connected but no domain health, trigger it
    if (customEmailStatus?.connected && customEmailStatus?.email && stats?.domainHealth === undefined) {
      if (!verifyDomainMutation.isPending) {
        // If there's a selected mailbox, verify *that* domain, otherwise fallback
        const targetEmail = selectedMailboxId && customEmailStatus?.integrations?.find(i => i.id === selectedMailboxId)?.email
          ? customEmailStatus.integrations.find(i => i.id === selectedMailboxId)!.email
          : customEmailStatus.email;

        const domain = getDomainFromEmail(targetEmail);
        if (domain) {
          verifyDomainMutation.mutate(domain);
        }
      }
    }
  }, [customEmailStatus?.connected, customEmailStatus?.email, stats?.domainHealth, selectedMailboxId, queryClient]);

  const integrations = Array.isArray(integrationsData) ? integrationsData : (integrationsData as any)?.integrations ?? [];
  const allMailboxes = customEmailStatus?.integrations || [];
  const hasMailboxesConnected = allMailboxes.length > 0;

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
    mutationFn: async (config: typeof customEmailConfig) => {
      const response = await apiRequest("POST", "/api/custom-email/connect", config);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      setIsEditingCustomEmail(false);
      setCustomEmailConfig({ smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993', email: '', password: '', fromName: '' });
      toast({ title: "Email Connected", description: "SMTP settings saved successfully." });
    },
    onError: (error: Error) => {
      // apiRequest throws "400: {json}" - try to extract structured error
      let errorMsg = error.message;
      let tipMsg = '';
      try {
        const jsonStr = error.message.replace(/^\d+:\s*/, '');
        const parsed = JSON.parse(jsonStr);
        errorMsg = parsed.error || errorMsg;
        tipMsg = parsed.tip || '';
      } catch { /* use raw message */ }
      const description = tipMsg ? `${errorMsg}\n\n💡 ${tipMsg}` : errorMsg;
      toast({ title: "Connection Failed", description, variant: "destructive" });
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

  const connectedMailboxesCount = (customEmailStatus?.integrations?.length || 0) +
    (integrations.filter((i: any) => i.provider === 'gmail' || i.provider === 'outlook').length || 0);

  const limit = getMailboxLimit();
  const isAtMailboxLimit = limit !== -1 && connectedMailboxesCount >= limit;

  const getNextPlan = () => {
    const tier = getActivePlanId(userData);
    if (tier === 'starter') return 'Pro';
    if (tier === 'pro') return 'Enterprise';
    return null;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <DisconnectConfirmationDialog
        isOpen={isDisconnectDialogOpen}
        onOpenChange={setIsDisconnectDialogOpen}
        onConfirm={() => {
          if (disconnectProvider === 'instagram') {
            disconnectProviderMutation.mutate({ provider: 'instagram', integrationId: disconnectIntegrationId || undefined });
          } else if (disconnectProvider === 'gmail') {
            disconnectProviderMutation.mutate({ provider: 'gmail', integrationId: disconnectIntegrationId || undefined });
          } else if (disconnectProvider === 'outlook') {
            disconnectProviderMutation.mutate({ provider: 'outlook', integrationId: disconnectIntegrationId || undefined });
          } else if (disconnectProvider) {
            // It's a custom email integration ID
            disconnectCustomEmailMutation.mutate(disconnectProvider);
          }
        }}
        providerName={disconnectProvider === 'instagram' ? 'Instagram' :
          disconnectProvider === 'gmail' ? 'Google Workspace' :
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Mail className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">Custom Email Domain</h2>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest border-border/50 bg-muted/20",
                  getActivePlanId(userData) === 'enterprise' ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5" : "text-muted-foreground"
                )}>
                  {connectedMailboxesCount} / {limit === -1 ? 'Unlimited' : limit} Integrations
                </Badge>
                <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest border-primary/20 bg-primary/5 text-primary">
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
                          "rounded-xl px-4 py-6 transition-all flex flex-col items-center gap-2 flex-1 min-w-[140px]",
                          isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise' 
                            ? "opacity-50 cursor-not-allowed border-muted bg-muted/20" 
                            : "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                        )}
                        onClick={() => handleConnect('gmail')}
                        disabled={isAtMailboxLimit && getActivePlanId(userData) !== 'enterprise'}
                      >
                        <SiGoogle className="h-5 w-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Connect Google</span>
                      </Button>

                      <Button
                        variant="outline"
                        className={cn(
                          "rounded-xl px-4 py-6 transition-all flex flex-col items-center gap-2 flex-1 min-w-[140px]",
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
                        className="rounded-xl px-4 py-6 border-border/50 bg-muted/20 text-foreground hover:bg-muted/30 transition-all flex flex-col items-center gap-2 flex-1 min-w-[140px]"
                        onClick={() => {
                          setCustomEmailConfig({ smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993', email: '', password: '', fromName: '' });
                          // Actually we are already in the edit view if we see this, but let's reset form
                        }}
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Custom SMTP</span>
                      </Button>
                    </div>
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
                        <Input
                          placeholder="John Doe"
                          value={customEmailConfig.fromName}
                          onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, fromName: e.target.value })}
                          className="rounded-xl border-border/50 focus:ring-primary/20"
                        />
                      </div>

                      {/* Dynamic App Password Guide */}
                      <AnimatePresence>
                        {appPasswordGuide && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="md:col-span-2 overflow-hidden"
                          >
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
                          </motion.div>
                        )}
                      </AnimatePresence>
                    
                    {[
                      { label: "SMTP Host", key: "smtpHost", placeholder: "e.g. smtp.gmail.com" },
                      { label: "SMTP Port", key: "smtpPort", placeholder: "587" },
                      { label: "App Password", key: "password", placeholder: "Minimum 16 characters", type: "password" },
                      { label: "IMAP Host (Optional)", key: "imapHost", placeholder: "e.g. imap.gmail.com" },
                      { label: "IMAP Port", key: "imapPort", placeholder: "993" }
                    ].map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1 flex items-center gap-1.5">
                          {field.label}
                          {field.key === 'password' && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertCircle className="h-3 w-3 text-primary animate-pulse cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[280px] p-4 space-y-3 bg-indigo-950/90 border-primary/20 backdrop-blur-xl">
                                  <div className="space-y-1">
                                    <p className="font-black text-[10px] uppercase tracking-widest text-primary flex items-center gap-2">
                                      <Sparkles className="h-3 w-3" /> Gmail / Outlook Guide
                                    </p>
                                    <p className="text-xs leading-relaxed text-foreground/90 italic">Manual connection for personal accounts requires a 16-character <strong>App Password</strong>.</p>
                                  </div>
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
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </Label>
                        <Input
                          type={field.type || "text"}
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
                      onClick={() => connectCustomEmailMutation.mutate(customEmailConfig)}
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
                    {allMailboxes.map((mailbox) => (
                      <div key={mailbox.id} className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-6 rounded-2xl bg-muted/20 border border-border/40 hover:border-primary/30 transition-all group">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "h-12 w-12 rounded-xl flex items-center justify-center border transition-all duration-300",
                            !mailbox.connected ? "bg-muted/10 border-dashed border-muted grayscale" :
                            mailbox.provider === 'gmail' ? "bg-red-500/10 border-red-500/20 text-red-500" :
                            mailbox.provider === 'outlook' ? "bg-blue-500/10 border-blue-500/20 text-blue-500" :
                            "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                          )}>
                            {mailbox.provider === 'gmail' ? <SiGoogle className="h-6 w-6" /> :
                             mailbox.provider === 'outlook' ? <Mail className="h-6 w-6" /> :
                             <CheckCircle2 className="h-6 w-6" />}
                          </div>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <h4 className={cn("text-sm font-bold transition-colors", !mailbox.connected ? "text-muted-foreground" : "text-foreground")}>
                                {mailbox.email}
                              </h4>
                              {mailbox.connected ? (
                                <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground border-muted text-[8px] font-black uppercase tracking-widest px-1.5 py-0">Disconnected</Badge>
                              )}
                            </div>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                              {mailbox.provider === 'gmail' ? "Google Workspace" :
                               mailbox.provider === 'outlook' ? "Outlook / Office 365" :
                               "Custom SMTP Account"}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-4 md:mt-0 transition-opacity">
                          {mailbox.connected && (
                            <div className="flex gap-4 px-4 py-2 bg-background/50 rounded-xl border border-border/50 mr-4">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reputation</span>
                                <span className={cn(
                                  "text-sm font-black",
                                  (mailbox.reputationScore ?? 100) >= 80 ? "text-emerald-500" :
                                  (mailbox.reputationScore ?? 100) >= 50 ? "text-amber-500" : "text-destructive"
                                )}>
                                  {mailbox.reputationScore ?? 100}/100
                                </span>
                              </div>
                              <div className="w-px bg-border/50" />
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bounce Rate</span>
                                <span className={cn(
                                  "text-sm font-black",
                                  ((mailbox.bounceRate ?? 0) * 100) < 2 ? "text-emerald-500" :
                                  ((mailbox.bounceRate ?? 0) * 100) < 5 ? "text-amber-500" : "text-destructive"
                                )}>
                                  {((mailbox.bounceRate ?? 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                            </div>
                          )}

                          {mailbox.connected && (
                            <Button variant="outline" size="sm" className="h-8 rounded-lg text-[10px] px-3 w-full sm:w-auto" onClick={() => setIsTestEmailOpen(true)}>
                              <Mail className="h-3 w-3 mr-1.5" /> Test Connection
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 rounded-lg text-[10px] px-3 font-bold text-destructive hover:bg-destructive/10 w-full sm:w-auto" 
                            onClick={() => confirmDisconnect(mailbox.provider, mailbox.id)}
                          >
                            <Unplug className="h-3 w-3 mr-1.5" /> {mailbox.connected ? "Disconnect" : "Remove Record"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                    <div className="flex items-center justify-around p-6 rounded-2xl bg-muted/20 border border-border/40 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 bg-primary rounded-full" />
                      <CircularProgress
                        value={stats?.messagesToday ? (stats.messagesToday / getDailyLimit()) * 100 : 0}
                        label={stats?.messagesToday || "0"}
                        sublabel="Sent Today"
                      />
                      <CircularProgress
                        value={stats?.messagesYesterday ? (stats.messagesYesterday / getDailyLimit()) * 100 : 0}
                        label={stats?.messagesYesterday || "0"}
                        sublabel="Sent Yesterday"
                        color="secondary"
                      />
                      <div className="absolute bottom-3 right-4 flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[9px] font-black text-emerald-500/80 uppercase tracking-widest">Real-time Feed</span>
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
                            calculateReputation() === null ? "bg-muted text-muted-foreground" :
                              parseFloat(calculateReputation()!) >= 70 ? "bg-emerald-500/10 text-emerald-500" : 
                              parseFloat(calculateReputation()!) >= 55 ? "bg-amber-500/10 text-amber-500" :
                              parseFloat(calculateReputation()!) >= 40 ? "bg-orange-500/10 text-orange-500" : "bg-red-500/10 text-red-500"
                          )}>
                            {calculateReputation() === null ? "Pending Analysis" : 
                             parseFloat(calculateReputation()!) >= 70 ? "Healthy" : 
                             parseFloat(calculateReputation()!) >= 55 ? "Attention Required" : 
                             parseFloat(calculateReputation()!) >= 40 ? "Cautious" : "Unhealthy - Reduced to 5/day"}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Domain Grade</p>
                          <div className="text-3xl font-black tracking-tighter text-foreground h-9 flex items-center">
                            {calculateReputation() !== null ? `${calculateReputation()}%` : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Engine Status</p>
                          <p className={cn(
                            "text-xs font-black uppercase tracking-widest pt-2",
                            calculateReputation() === null ? "text-muted-foreground" :
                              parseFloat(calculateReputation()!) >= 70 ? "text-emerald-500" : 
                              parseFloat(calculateReputation()!) >= 40 ? "text-orange-500" : "text-red-500"
                          )}>
                            {calculateReputation() === null ? "Waiting" : parseFloat(calculateReputation()!) >= 70 ? "Autonomous" : "User Oversight Recommended"}
                          </p>
                        </div>
                      </div>

                      <div className={cn(
                        "p-3 rounded-xl border text-[10px] leading-tight font-medium transition-all duration-300",
                        calculateReputation() === null ? "bg-muted/10 border-border/20 text-muted-foreground" :
                          parseFloat(calculateReputation()!) >= 70
                            ? "bg-primary/5 border-primary/10 text-muted-foreground"
                            : parseFloat(calculateReputation()!) >= 40
                            ? "bg-orange-500/5 border-orange-500/10 text-orange-400"
                            : "bg-red-500/5 border-red-500/10 text-red-400"
                      )}>
                        {calculateReputation() === null ? "AI is initiating a health checkpoint for your domain." :
                          parseFloat(calculateReputation()!) >= 70
                            ? "Your domain parameters are within safe limits. AI is managing 1-by-1 sending autonomously."
                            : parseFloat(calculateReputation()!) >= 40
                            ? "Warning: Reputation drops detected. Sending speed is reduced to protect deliverability."
                            : "Critical: Low reputation detected. Sending speed drastically throttled to 5 per day to prevent blocklisting."}
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
                                  <div className="grid grid-cols-4 gap-1">
                                    {['SPF', 'DKIM', 'DMARC', 'MX'].map(record => {
                                      const key = record.toLowerCase();
                                      const isFound = v.result[key]?.found;
                                      const isValid = v.result[key]?.valid ?? true;
                                      return (
                                        <div key={record} className="flex flex-col items-center gap-1 p-1 rounded bg-black/20">
                                          <span className="text-[7px] font-bold text-muted-foreground uppercase">{record}</span>
                                          <div className={cn(
                                            "h-1 w-full rounded-full",
                                            isFound && isValid ? "bg-emerald-500" : isFound ? "bg-amber-500" : "bg-red-500"
                                          )} />
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
                    <div className="h-24 w-24 rounded-[2.5rem] bg-primary/5 flex items-center justify-center border border-primary/10 relative shadow-inner group">
                      <div className="absolute inset-0 bg-primary/5 blur-xl group-hover:bg-primary/10 transition-all rounded-full" />
                      <Mail className="h-10 w-10 text-primary relative z-10" />
                    </div>
                    <div className="space-y-2 max-w-sm">
                      <h3 className="text-2xl font-black tracking-tight">Connect Custom Domain</h3>
                      <p className="text-sm font-medium text-muted-foreground leading-relaxed px-4">Professional outreach requires a custom SMTP & IMAP connection for high deliverability.</p>
                    </div>
                    <Button 
                      className="rounded-2xl gap-2 h-12 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest shadow-xl shadow-primary/20"
                      onClick={() => setIsEditingCustomEmail(true)}
                    >
                      <Plus className="h-4 w-4" /> Start Connecting
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Social and SaaS Integrations */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {isLoading ? (
                // Skeleton loading for integration cards
                Array.from({ length: 4 }).map((_, i) => (
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
                        {isConnected && connectedIntegrations.map(integration => (
                          <div key={integration.id || Math.random()} className="flex items-center justify-between w-full p-2 rounded bg-background/50 border border-border/30">
                            <span className="text-[10px] font-medium truncate max-w-[120px]" title={integration.accountType?.toString() || ""}>{integration.accountType || "Connected"}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10"
                              onClick={() => confirmDisconnect(card.id, (integration as any).id)} // Need to pass ID if it exists? The API revokes by provider, but custom_email takes ID. For others, backend might need updates to revoke by ID. For now just passing provider string.
                            >
                              Disconnect
                            </Button>
                          </div>
                        ))}
                        
                        <Button
                          variant={card.badge ? "secondary" : (isConnected ? "outline" : "default")}
                          size="sm"
                          className="w-full rounded-lg text-xs font-semibold"
                          disabled={!!card.badge}
                          onClick={() => handleConnect(card.id)}
                        >
                          {card.badge ? "Locked" : (isConnected ? "Connect Another" : "Connect Account")}
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </TabsContent >


        <TabsContent value="voice">
          <Card className="rounded-2xl border-border/50 overflow-hidden">
            <CardHeader className="p-8 border-b bg-muted/20">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl font-semibold">AI Voice Cloning</CardTitle>
              </div>
              <CardDescription className="text-sm font-medium pt-2">
                Enable your AI to send personalized voice messages to leads.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <div className="p-6 rounded-xl bg-muted/30 border border-border/50 space-y-4">
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Recording Guidelines</h4>
                    <ul className="space-y-3">
                      {[
                        "Record in a quiet environment",
                        "Speak naturally at a normal pace",
                        "At least 1 minute of high-quality audio",
                        "Use WAV or MP3 format"
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground font-medium">
                          <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div
                  className="group relative border-2 border-dashed border-border/50 hover:border-primary/40 transition-all rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer bg-muted/20"
                  onClick={() => voiceInputRef.current?.click()}
                >
                  <input
                    ref={voiceInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={handleVoiceFileSelect}
                  />
                  <div className="h-16 w-16 rounded-full bg-background border border-border flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    {isUploadingVoice ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
                  </div>
                  <h3 className="text-sm font-semibold mb-1">Click to Upload Sample</h3>
                  <p className="text-xs text-muted-foreground">MP3, WAV, or M4A files up to 10MB</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs >
    </div >
  );
}

function SwitchIcon({ connected }: { connected: boolean }) {
  return (
    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
  );
}
