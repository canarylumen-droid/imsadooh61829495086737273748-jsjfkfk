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
  Unplug
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
import { io } from "socket.io-client";

interface Integration {
  provider: string;
  connected: boolean;
  lastSync?: string;
  accountInfo?: {
    email?: string;
    username?: string;
  };
}

interface IntegrationsResponse {
  integrations: Integration[];
}

interface UserData {
  user: {
    id: string;
    email: string;
    subscriptionTier?: string;
    totalLeads?: number;
  };
}

const integrationCards = [
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
    do: "email",
    id: "gmail",
    name: "Google Workspace",
    description: "Connect your business email for automated outreach and follow-ups.",
    icon: SiGoogle,
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
  {
    do: "store",
    id: "shopify",
    name: "Shopify",
    description: "Sync your store data for AI-powered product recommendations.",
    icon: SiShopify,
    color: "text-green-500",
    bg: "bg-green-500/10",
    badge: "Coming Soon"
  },
  {
    do: "crm",
    id: "hubspot",
    name: "HubSpot",
    description: "Automatically sync leads and deals with your HubSpot CRM.",
    icon: SiHubspot,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    badge: "Coming Soon"
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

  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  const { data: integrationsData, isLoading } = useQuery<IntegrationsResponse>({ queryKey: ["/api/integrations"] });
  const { data: customEmailStatus } = useQuery<{ connected: boolean; email: string | null; provider: string }>({ queryKey: ["/api/custom-email/status"] });
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
    refetchInterval: 300000, // 5 minutes
  });
  const { data: userData } = useQuery<UserData>({ queryKey: ["/api/user/profile"] });

  useEffect(() => {
    if (!userData?.user?.id) return;

    const socket = io({
      path: '/socket.io',
      query: { userId: userData.user.id }
    });

    socket.on('settings_updated', () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    });

    return () => {
      socket.disconnect();
    };
  }, [userData?.user?.id, queryClient]);

  const [tickerTime, setTickerTime] = useState(Date.now());

  // Auto-fill common email providers
  useEffect(() => {
    const email = customEmailConfig.email.toLowerCase();
    if (!email.includes('@')) return;

    const domain = email.split('@')[1];
    if (!domain) return;

    const providers: Record<string, any> = {
      'gmail.com': {
        smtpHost: 'smtp.gmail.com',
        smtpPort: '587',
        imapHost: 'imap.gmail.com',
        imapPort: '993',
      },
      'outlook.com': {
        smtpHost: 'smtp-mail.outlook.com',
        smtpPort: '587',
        imapHost: 'outlook.office365.com',
        imapPort: '993',
      },
      'hotmail.com': {
        smtpHost: 'smtp-mail.outlook.com',
        smtpPort: '587',
        imapHost: 'outlook.office365.com',
        imapPort: '993',
      },
      'live.com': {
        smtpHost: 'smtp-mail.outlook.com',
        smtpPort: '587',
        imapHost: 'outlook.office365.com',
        imapPort: '993',
      },
      'office365.com': {
        smtpHost: 'smtp.office365.com',
        smtpPort: '587',
        imapHost: 'outlook.office365.com',
        imapPort: '993',
      },
      'icloud.com': {
        smtpHost: 'smtp.mail.me.com',
        smtpPort: '587',
        imapHost: 'imap.mail.me.com',
        imapPort: '993',
      },
      'yahoo.com': {
        smtpHost: 'smtp.mail.yahoo.com',
        smtpPort: '465',
        imapHost: 'imap.mail.yahoo.com',
        imapPort: '993',
      },
    };

    if (providers[domain]) {
      const match = providers[domain];
      setCustomEmailConfig(prev => ({
        ...prev,
        smtpHost: prev.smtpHost === '' ? match.smtpHost : prev.smtpHost,
        smtpPort: prev.smtpPort === '587' || prev.smtpPort === '' ? match.smtpPort : prev.smtpPort,
        imapHost: prev.imapHost === '' ? match.imapHost : prev.imapHost,
        imapPort: prev.imapPort === '993' || prev.imapPort === '' ? match.imapPort : prev.imapPort,
      }));
    }
  }, [customEmailConfig.email]);

  useEffect(() => {
    const timer = setInterval(() => setTickerTime(Date.now()), 47); // ~21fps for high-fidelity ticker
    return () => clearInterval(timer);
  }, []);

  const getDailyLimit = () => {
    const tier = userData?.user?.subscriptionTier?.toLowerCase();
    if (tier === 'enterprise') return 500;
    if (tier === 'pro') return 400;
    return 300; // Default / Starter
  };

  const calculateReputation = () => {
    return (stats?.domainHealth ?? 100).toFixed(1);
  };

  const integrations = integrationsData?.integrations ?? [];
  const isCustomEmailConnected = customEmailStatus?.connected || false;

  const disconnectProviderMutation = useMutation({
    mutationFn: async (provider: string) => {
      const response = await apiRequest("POST", `/api/integrations/${provider}/disconnect`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({ title: "Disconnected", description: "Integration removed successfully." });
    }
  });

  const connectCustomEmailMutation = useMutation({
    mutationFn: async (config: typeof customEmailConfig) => {
      // Use standard fetch to handle response status and get error body
      const response = await fetch("/api/custom-email/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        credentials: "include"
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to connect mailbox");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
      setIsEditingCustomEmail(false);
      setCustomEmailConfig({ smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993', email: '', password: '', fromName: '' });
      toast({ title: "Email Connected", description: "SMTP settings saved successfully." });
    },
    onError: (error: Error) => {
      const errorMessage = error.message;
      const isGmail = customEmailConfig.email.toLowerCase().includes('gmail.com');
      const isOutlook = customEmailConfig.email.toLowerCase().includes('outlook.com') || customEmailConfig.email.toLowerCase().includes('office365.com');
      const isAuthError = errorMessage.toLowerCase().includes('app password') || 
                         errorMessage.toLowerCase().includes('password not accepted') ||
                         errorMessage.toLowerCase().includes('invalid login');

      if ((isGmail || isOutlook) && isAuthError) {
        toast({
          title: 'App Password Required',
          description: (
            <div className="space-y-2">
              <p>It looks like you're using {isGmail ? 'Gmail' : 'Outlook'} with 2FA enabled. You MUST use an <strong>App Password</strong>, not your regular password.</p>
              <a 
                href={isGmail ? "https://myaccount.google.com/apppasswords" : "https://account.microsoft.com/security"} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-cyan-600 hover:underline font-bold block mt-2"
              >
                Click here to generate one →
              </a>
            </div>
          ) as any,
          variant: 'destructive',
          duration: 15000
        });
      } else {
        toast({ title: "Connection Failed", description: errorMessage, variant: "destructive", duration: 10000 });
      }
    }
  });

  const disconnectCustomEmailMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/custom-email/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-email/status"] });
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
    try {
      const response = await fetch(`/api/oauth/connect/${provider}`);
      const { authUrl } = await response.json();
      if (authUrl) window.location.href = authUrl;
    } catch (e) {
      toast({ title: "Error", description: "Could not start connection setup.", variant: "destructive" });
    }
  };

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

  const confirmDisconnect = (provider: string) => {
    setDisconnectProvider(provider);
    setIsDisconnectDialogOpen(true);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <DisconnectConfirmationDialog
        isOpen={isDisconnectDialogOpen}
        onOpenChange={setIsDisconnectDialogOpen}
        providerName={disconnectProvider === 'custom_email' ? 'Custom Email' : disconnectProvider || 'Integration'}
        onConfirm={() => {
          if (disconnectProvider === 'custom_email') {
            disconnectCustomEmailMutation.mutate();
          } else if (disconnectProvider) {
            disconnectProviderMutation.mutate(disconnectProvider);
          }
        }}
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

        <TabsContent value="connected" className="space-y-8">
          {/* Email Integration Section */}
          <Card className="rounded-2xl border-border/50 overflow-hidden">
            <CardHeader className="p-8 border-b bg-muted/20">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl bg-primary/10 text-primary`}>
                    <Mail className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Custom Email Server</h2>
                    <p className="text-sm text-muted-foreground">Connect your own SMTP/IMAP settings for maximum deliverability.</p>
                  </div>
                </div>
                {isCustomEmailConnected ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0 font-semibold px-4 py-1 rounded-full uppercase text-[10px] tracking-wider">
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground border-border/50 font-semibold px-4 py-1 rounded-full uppercase text-[10px] tracking-wider">
                    Offline
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-8">
              {isCustomEmailConnected && !isEditingCustomEmail ? (
                <div className="flex flex-col md:flex-row items-center justify-between bg-muted/30 p-6 rounded-xl border border-border/40">
                  <div className="flex items-center gap-4 mb-6 md:mb-0">
                    <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{customEmailStatus?.email}</p>
                      <p className="text-xs text-muted-foreground font-medium">Primary Sending Address</p>
                    </div>
                  </div>
                  <div className="flex gap-3 w-full md:w-auto">
                    <Button variant="outline" size="sm" className="rounded-lg h-9" onClick={() => setIsTestEmailOpen(true)}>
                      <Mail className="h-3.5 w-3.5 mr-2" /> Test Send
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg h-9" onClick={() => setIsEditingCustomEmail(true)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-lg h-9 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => confirmDisconnect('custom_email')}>
                      <Unplug className="h-3.5 w-3.5 mr-2" /> Disconnect
                    </Button>
                  </div>
                </div>
              ) : null}

              {isCustomEmailConnected && !isEditingCustomEmail && (
                <div className="mt-8 pt-8 border-t grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="flex items-center justify-around p-6 rounded-2xl bg-muted/20 border border-border/40 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 bg-primary rounded-full" />
                    <CircularProgress
                      value={stats?.messagesToday ? (stats.messagesToday / 500) * 100 : 0}
                      label={stats?.messagesToday || "0"}
                      sublabel="Sent Today"
                    />
                    <CircularProgress
                      value={stats?.messagesYesterday ? (stats.messagesYesterday / 500) * 100 : 0}
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
                        <p className="text-[10px] text-muted-foreground font-medium uppercase">Last synced: Just now</p>
                      </div>
                      <Badge className={cn(
                        "text-[9px] font-black border-0 uppercase tracking-tighter",
                        parseFloat(calculateReputation()) > 90 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                      )}>
                        {parseFloat(calculateReputation()) > 90 ? "Healthy" : "Attention Required"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-0.5">
                        <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Domain Grade</p>
                        <p className="text-3xl font-black tracking-tighter text-foreground">{calculateReputation()}%</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Engine Status</p>
                        <p className={cn(
                          "text-xs font-black uppercase tracking-widest pt-2",
                          parseFloat(calculateReputation()) > 90 ? "text-emerald-500" : "text-amber-500"
                        )}>
                          {parseFloat(calculateReputation()) > 95 ? "Autonomous" : "User Oversight Recommended"}
                        </p>
                      </div>
                    </div>

                    <div className={cn(
                      "p-3 rounded-xl border text-[10px] leading-tight font-medium",
                      parseFloat(calculateReputation()) > 90
                        ? "bg-primary/5 border-primary/10 text-muted-foreground"
                        : "bg-red-500/5 border-red-500/10 text-red-400"
                    )}>
                      {parseFloat(calculateReputation()) > 90
                        ? "Your domain parameters are within safe limits. AI is managing 1-by-1 sending autonomously."
                        : "Warning: Low reputation detected. Engine will auto-pause if bounce rate exceeds 10%."}
                    </div>

                    {stats?.domainVerifications?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[9px] font-bold text-muted-foreground/60 uppercase">Recent Checks</p>
                        <div className="space-y-1.5">
                          {stats.domainVerifications.map((v: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-[10px] bg-white/5 p-2 rounded-lg">
                              <span className="text-white/60">{v.domain}</span>
                              <Badge className={cn(
                                "text-[8px] h-4 py-0",
                                v.verification_result === 'pass' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                              )}>
                                {v.verification_result}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(!isCustomEmailConnected || isEditingCustomEmail) && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs font-semibold text-muted-foreground ml-1">From Name (Displayed to recipients)</Label>
                      <Input
                        placeholder="John Doe"
                        value={customEmailConfig.fromName}
                        onChange={(e) => setCustomEmailConfig({ ...customEmailConfig, fromName: e.target.value })}
                        className="rounded-xl border-border/50 focus:ring-primary/20"
                      />
                    </div>
                    {[
                      { label: "SMTP Host", key: "smtpHost", placeholder: "e.g. smtp.gmail.com" },
                      { label: "SMTP Port", key: "smtpPort", placeholder: "587" },
                      { label: "Email Address", key: "email", placeholder: "your@email.com" },
                      { label: "App Password", key: "password", placeholder: "Minimum 16 characters", type: "password" },
                      { label: "IMAP Host (Optional)", key: "imapHost", placeholder: "e.g. imap.gmail.com" },
                      { label: "IMAP Port", key: "imapPort", placeholder: "993" }
                    ].map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label className="text-xs font-semibold text-muted-foreground ml-1">{field.label}</Label>
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
                  <div className="flex gap-4">
                    <Button
                      className="rounded-xl px-8 font-semibold h-11 flex-1 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
                      disabled={connectCustomEmailMutation.isPending}
                      onClick={() => connectCustomEmailMutation.mutate(customEmailConfig)}
                    >
                      {connectCustomEmailMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {connectCustomEmailMutation.isPending ? "Connecting..." : "Add Mailbox"}
                    </Button>
                    {isEditingCustomEmail && (
                      <Button variant="outline" className="rounded-xl px-8 font-semibold h-11" onClick={() => setIsEditingCustomEmail(false)}>Cancel</Button>
                    )}
                  </div>

                </div>
              )}
            </CardContent>
          </Card>

          {/* Social and SaaS Integrations */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {integrationCards.map((card) => {
              const integration = integrations.find(i => i.provider === card.id);
              const isConnected = !!integration;

              return (
                <Card key={card.id} className={`group transition-all rounded-2xl border bg-muted/10 hover:bg-muted/20 ${isConnected ? 'border-primary/40 bg-primary/5' : 'border-border/50'}`}>
                  <CardHeader className="p-6">
                    <div className="flex justify-between items-start mb-6">
                      <div className={`p-4 rounded-xl bg-background border border-border/50 ${card.color}`}>
                        <card.icon className="h-6 w-6" />
                      </div>
                      {card.badge ? (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground border-0 font-semibold text-[9px] uppercase tracking-wider py-1">{card.badge}</Badge>
                      ) : isConnected ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-0 font-bold text-[9px] uppercase tracking-wider py-1">Active</Badge>
                      ) : (
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/20" />
                      )}
                    </div>
                    <CardTitle className="text-lg font-semibold">{card.name}</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">{card.description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="p-6 pt-0">
                    {isConnected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full rounded-lg text-xs font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => confirmDisconnect(card.id)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant={card.badge ? "secondary" : "default"}
                        size="sm"
                        className="w-full rounded-lg text-xs font-semibold"
                        disabled={!!card.badge}
                        onClick={() => handleConnect(card.id)}
                      >
                        {card.badge ? "Locked" : "Connect Account"}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        </TabsContent>


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
      </Tabs>
    </div >
  );
}

function SwitchIcon({ connected }: { connected: boolean }) {
  return (
    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
  );
}
