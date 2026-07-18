import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  User,
  Loader2,
  Upload,
  Mic,
  Settings,
  Save,
  Brain,
  Mail,
  RefreshCw,
  CheckCircle2,
  Plus,
  Phone,
  Sparkles,
  Copy,
  Check,
  Download,
  Construction,
  Key,
  Terminal,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Eye,
  X,
  ExternalLink,
  Code,
  Server,
  Edit3,
  Shield,
  Undo2,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCanAccessVoiceNotes } from "@/hooks/use-access-gate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { BrandKnowledgeBase } from "@/components/admin/BrandKnowledgeBase";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";

interface UserProfile {
  id: string;
  email: string;
  username?: string;
  name?: string;
  avatar?: string;
  company?: string;
  timezone?: string;
  plan?: string;
  voiceNotesEnabled?: boolean;
  defaultCtaLink?: string;
  defaultCtaText?: string;
  metadata?: any;
  defaultPaymentLink?: string;
  offerDescription?: string;
  offerValue?: number;
  offerDescription2?: string;
  offerValue2?: number;
  doubleOfferEnabled?: boolean;
  aiAdjustCopyEnabled?: boolean;
  pdfConfidenceThreshold?: number;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  scope: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

export default function SettingsPage() {
  useRealtime();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab && ['profile', 'brand', 'ai', 'developer', 'voice', 'account'].includes(tab)) return tab;
    }
    return "profile";
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState("read_write");
  const [showCreateKey, setShowCreateKey] = useState(false);
  const { data: user, isLoading } = useQuery<UserProfile | null>({
    queryKey: ["/api/user/profile"],
    refetchOnMount: true,
    staleTime: 0,
  });
  const { data: smtpData } = useQuery<any[]>({ queryKey: ["/api/smtp/settings"] });
  const { data: customEmailStatus } = useQuery<any>({ queryKey: ["/api/custom-email/status"] });
  const { canAccess: canAccessVoiceNotes } = useCanAccessVoiceNotes();

  const { data: apiKeys, refetch: refetchApiKeys } = useQuery<ApiKey[]>({
    queryKey: ["/api/developer/api-keys"],
    enabled: activeTab === "developer",
  });

  const [formData, setFormData] = useState({
    name: "",
    username: "",
    company: "",
    timezone: "America/New_York",
    ctaLink: "",
    ctaText: "",
    calendarLink: "",
    voiceNotesEnabled: true,
    autonomousMode: true,
    discoverInboundLeads: true,
    prioritizeCalls: true,
    defaultPaymentLink: "",
    offerDescription: "",
    offerValue: 0,
    offerDescription2: "",
    offerValue2: 0,
    doubleOfferEnabled: false,
    aiAdjustCopyEnabled: true,
    pdfConfidenceThreshold: 85,
  });

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || "",
        username: user.username || "",
        company: user.company || "",
        timezone: user.timezone || "America/New_York",
        ctaLink: user.defaultCtaLink || "",
        ctaText: user.defaultCtaText || "",
        calendarLink: (user as any).calendarLink || "",
        voiceNotesEnabled: user.voiceNotesEnabled ?? true,
        autonomousMode: (user as any).config?.autonomousMode !== false,
        discoverInboundLeads: (user as any).config?.discoverInboundLeads !== false,
        prioritizeCalls: (user as any).config?.prioritizeCalls !== false,
        defaultPaymentLink: user.defaultPaymentLink || "",
        offerDescription: (user as any).offerDescription || "",
        offerValue: (user as any).offerValue || 0,
        offerDescription2: (user as any).offerDescription2 || "",
        offerValue2: (user as any).offerValue2 || 0,
        doubleOfferEnabled: (user as any).doubleOfferEnabled ?? false,
        aiAdjustCopyEnabled: (user as any).aiAdjustCopyEnabled ?? true,
        pdfConfidenceThreshold: user.pdfConfidenceThreshold ?? 85,
      });
    }
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const { autonomousMode, discoverInboundLeads, prioritizeCalls, ...rest } = data;
      const payload = {
        ...rest,
        ...((autonomousMode !== undefined || discoverInboundLeads !== undefined || prioritizeCalls !== undefined) && {
          config: {
            ...((user as any)?.config || {}),
            ...(autonomousMode !== undefined && { autonomousMode }),
            ...(discoverInboundLeads !== undefined && { discoverInboundLeads }),
            ...(prioritizeCalls !== undefined && { prioritizeCalls })
          }
        })
      };
      return apiRequest("PUT", "/api/user/profile", payload);
    },
    onSuccess: () => {
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({ title: "Settings Saved", description: "Your profile has been updated." });
    },
    onError: () => toast({ title: "Update Failed", variant: "destructive" })
  });

  const [avatarVersion, setAvatarVersion] = useState(0);
  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch('/api/user/avatar', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAvatarVersion(v => v + 1);
      queryClient.setQueryData(["/api/user/profile"], (old: any) => ({ ...old, avatar: data.avatar }));
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({ title: "Avatar Updated" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" })
  });

  const cloneVoiceMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const formData = new FormData();
      Array.from(files).forEach(file => formData.append('voice_samples', file));
      const res = await fetch('/api/voice/clone', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cloning failed');
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Voice Cloned", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    },
    onError: (error: any) => toast({ title: "Cloning Failed", description: error.message, variant: "destructive" })
  });

  const { data: voiceUsage } = useQuery<any>({
    queryKey: ["/api/voice/usage"],
    enabled: !!user && (user.voiceNotesEnabled || canAccessVoiceNotes)
  });

  const syncEmailMutation = useMutation({
    mutationFn: async () => {
      if (!customEmailStatus?.integrations) throw new Error("No mailboxes found.");
      const connected = customEmailStatus.integrations.filter((i: any) => i.connected);
      if (connected.length === 0) throw new Error("Please connect a custom domain mailbox first.");
      for (const i of connected) {
        await apiRequest("POST", "/api/custom-email/sync-history", { days: 30, integrationId: i.id });
      }
      await apiRequest("POST", "/api/custom-email/sync-now");
    },
    onSuccess: () => {
      toast({ title: "Sync Started", description: "Your email history (last 30 days) is being synchronized in the background." });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
    onError: (err: any) => toast({ title: "Sync Failed", description: err.message, variant: "destructive" })
  });

  const createApiKeyMutation = useMutation({
    mutationFn: async ({ name, scope }: { name: string; scope: string }) => {
      const res = await apiRequest("POST", "/api/developer/api-keys", { name, scope });
      return res.json();
    },
    onSuccess: (data: any) => {
      setShowNewKey(data.key);
      setNewKeyName("");
      setNewKeyScope("read_write");
      setShowCreateKey(false);
      refetchApiKeys();
      toast({ title: "API Key Created", description: "Copy your key now — you won't see it again." });
    },
    onError: () => toast({ title: "Failed", description: "Could not create API key.", variant: "destructive" })
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/developer/api-keys/${id}`);
    },
    onSuccess: () => {
      refetchApiKeys();
      toast({ title: "API Key Deleted" });
    },
    onError: () => toast({ title: "Failed", description: "Could not delete API key.", variant: "destructive" })
  });

  const editKeyNameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return apiRequest("PATCH", `/api/developer/api-keys/${id}`, { name });
    },
    onSuccess: () => {
      refetchApiKeys();
      toast({ title: "Key Name Updated" });
    },
    onError: () => toast({ title: "Failed", description: "Could not update key name.", variant: "destructive" })
  });

  const handleFieldChange = (key: string, val: any) => {
    setFormData(prev => ({ ...prev, [key]: val }));
    setHasChanges(true);
  };

  const handleCopyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast({ title: "Copied to clipboard", description: `${fieldName} has been copied.` });
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (isLoading || !user) return <div className="flex justify-center p-20"><PremiumLoader text="Loading Settings..." /></div>;

  return (
    <PageWrapper className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="rounded-md font-bold text-[10px] uppercase tracking-wider bg-primary/10 text-primary border-primary/20">
              Account Settings
            </Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your account, integrations, and developer tools.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Export dropdown remains */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-xl px-5 h-11 font-bold border-border/50 hover:bg-muted/30">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-xl">
              {([
                ['replied', 'text-emerald-500', 'Leads That Replied'],
                ['booked', 'text-blue-500', 'Leads That Booked Call'],
                ['no_show', 'text-red-500', 'No Show'],
                ['no_reply', 'text-orange-500', 'No Reply'],
                ['ghosted', 'text-purple-500', 'Ghosted'],
              ] as const).map(([cat, color, label]) => (
                <DropdownMenuItem
                  key={cat}
                  className="font-medium text-sm cursor-pointer"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/bulk/export-category?category=${cat}`, { credentials: 'include' });
                      if (!res.ok) {
                        toast({ title: 'No Leads', description: `No leads found in "${label}".`, variant: 'default' });
                        return;
                      }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `audnix_${cat}_${Date.now()}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast({ title: 'Exported', description: `${label} CSV downloaded.` });
                    } catch {
                      toast({ title: 'Failed', description: 'Could not export leads.', variant: 'destructive' });
                    }
                  }}
                >
                  <span className={`${color} mr-2`}>●</span> {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="font-medium text-sm cursor-pointer"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/bulk/export-category?category=converted', { credentials: 'include' });
                    if (!res.ok) {
                      toast({ title: 'No Leads', description: 'No converted leads found.' });
                      return;
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `audnix_converted_${Date.now()}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast({ title: 'Exported', description: 'Converted leads CSV downloaded.' });
                  } catch {
                    toast({ title: 'Failed', description: 'Could not export leads.', variant: 'destructive' });
                  }
                }}
              >
                <span className="text-yellow-500 mr-2">●</span> Converted / Paid
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasChanges && (
            <Button
              onClick={() => saveMutation.mutate(formData)}
              className="rounded-xl px-6 h-11 font-bold shadow-lg shadow-primary/20"
            >
              {saveMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="profile" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 p-1 rounded-xl mb-8 w-full flex overflow-x-auto no-scrollbar justify-start md:justify-start gap-1 border border-border/30">
          <TabsTrigger value="profile" className="flex-shrink-0 rounded-lg px-4 md:px-5 py-2.5 font-bold text-xs md:text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <User className="h-3.5 w-3.5 mr-2 hidden sm:inline" /> Profile
          </TabsTrigger>
          <TabsTrigger value="brand" className="flex-shrink-0 rounded-lg px-4 md:px-5 py-2.5 font-bold text-xs md:text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Brain className="h-3.5 w-3.5 mr-2 hidden sm:inline" /> Intelligence
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex-shrink-0 rounded-lg px-4 md:px-5 py-2.5 font-bold text-xs md:text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Settings className="h-3.5 w-3.5 mr-2 hidden sm:inline" /> Automation
          </TabsTrigger>
          <TabsTrigger value="developer" className="flex-shrink-0 rounded-lg px-4 md:px-5 py-2.5 font-bold text-xs md:text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Code className="h-3.5 w-3.5 mr-2 hidden sm:inline" /> Developer
          </TabsTrigger>
          <TabsTrigger value="voice" className="flex-shrink-0 rounded-lg px-4 md:px-5 py-2.5 font-bold text-xs md:text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Mic className="h-3.5 w-3.5 mr-2 hidden sm:inline" /> Voice
          </TabsTrigger>
          <TabsTrigger value="account" className="flex-shrink-0 rounded-lg px-4 md:px-5 py-2.5 font-bold text-xs md:text-sm whitespace-nowrap data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-destructive">
            <ShieldAlert className="h-3.5 w-3.5 mr-2 hidden sm:inline" /> Account
          </TabsTrigger>
        </TabsList>

        {/* Profile tab */}
        <TabsContent value="profile" className="space-y-6">
          <ResponsiveGrid className="grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center p-4 sm:p-8">
                <div className="relative group mb-6">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full animate-pulse ring-2 ring-emerald-400/50 ring-offset-2 ring-offset-background" />
                    <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-emerald-400/20 via-transparent to-emerald-400/10 animate-spin" style={{ animationDuration: '4s' }} />
                    <Avatar className="h-28 w-28 sm:h-32 sm:w-32 border-2 border-border/50 shadow-md ring-2 ring-primary/10 group-hover:ring-primary/30 transition-all duration-300 relative rounded-full">
                      <AvatarImage src={user.avatar || undefined} className="object-cover rounded-full" />
                      <AvatarFallback className="text-3xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-bold rounded-full">
                        {user.name?.[0]?.toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-[3px] border-background z-10" />
                  </div>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 rounded-full shadow-lg border border-border/40 bg-background hover:bg-muted h-9 w-9"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadAvatarMutation.mutate(e.target.files[0])} />
                </div>
                <div className="text-center space-y-1 mb-6">
                  <h3 className="text-xl font-bold">{user.name || 'Set your name'}</h3>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <Badge variant="outline" className="px-4 py-1.5 rounded-full font-bold uppercase tracking-wider text-[10px] border-primary/20 bg-primary/5 text-primary">
                  {user.plan || 'Free'} Plan
                </Badge>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Profile Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <ResponsiveGrid className="grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Full Name</Label>
                    <Input
                      value={formData.name}
                      onChange={e => handleFieldChange('name', e.target.value)}
                      className="rounded-xl h-11 bg-background border-border/40"
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Username</Label>
                    <Input
                      value={formData.username}
                      onChange={e => handleFieldChange('username', e.target.value)}
                      className="rounded-xl h-11 bg-background border-border/40"
                      placeholder="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Company</Label>
                    <Input
                      value={formData.company}
                      onChange={e => handleFieldChange('company', e.target.value)}
                      className="rounded-xl h-11 bg-background border-border/40"
                      placeholder="Your company"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Calendar Link</Label>
                      {(user as any).calendlyAccessToken ? (
                        <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest text-emerald-500 border-emerald-500/20 bg-emerald-500/5 h-5">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Calendly
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-[9px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 p-0"
                          onClick={() => {
                            fetch('/api/oauth/connect/calendly')
                              .then(res => res.json())
                              .then(data => { if (data.authUrl) window.location.href = data.authUrl; });
                          }}
                        >
                          <Plus className="h-2.5 w-2.5 mr-1" /> Connect
                        </Button>
                      )}
                    </div>
                    <Input
                      value={formData.calendarLink}
                      onChange={e => handleFieldChange('calendarLink', e.target.value)}
                      placeholder="https://calendly.com/your-link"
                      className="rounded-xl h-11 bg-background border-border/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Timezone</Label>
                    <Select value={formData.timezone} onValueChange={v => handleFieldChange('timezone', v)}>
                      <SelectTrigger className="rounded-xl h-11 bg-background border-border/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                        <SelectItem value="Europe/London">London (GMT)</SelectItem>
                        <SelectItem value="Africa/Lagos">West Africa (WAT)</SelectItem>
                        <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                        <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </ResponsiveGrid>
              </CardContent>
            </Card>
          </ResponsiveGrid>
        </TabsContent>

        {/* Brand Intelligence tab */}
        <TabsContent value="brand" className="space-y-6">
          <BrandKnowledgeBase embedded={true} />
        </TabsContent>

        {/* Automation tab */}
        <TabsContent value="ai" className="space-y-6">
          <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Automation Controls
              </CardTitle>
              <CardDescription>Manage how the system interacts with leads across all channels.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 bg-gradient-to-br from-primary/5 to-purple-500/5 rounded-2xl border border-primary/15 hover:border-primary/30 transition-all gap-4">
                <div className="flex gap-4 items-start">
                  <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 shrink-0 mt-1">
                    <Brain className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm uppercase tracking-tight flex items-center gap-2">
                      AI Autonomous Orchestrator
                      <Badge className="bg-primary text-primary-foreground text-[9px] font-black uppercase px-2 py-0 border-0">V3.5</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed mt-1">
                      Enable global AI engine to handle outreach, replies, and follow-ups 24/7.
                    </p>
                  </div>
                </div>
                <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                  <Switch
                    checked={formData.autonomousMode}
                    onCheckedChange={c => handleFieldChange('autonomousMode', c)}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              {[
                {
                  icon: Mail,
                  title: "Inbound Lead Discovery",
                  badge: "CRM Controls",
                  desc: "Auto-create leads when unknown contacts send inbound emails. Disable to only sync existing contacts.",
                  key: "discoverInboundLeads",
                },
                {
                  icon: Phone,
                  title: "Prioritize Booked Calls",
                  badge: "Closing Strategy",
                  desc: "Force AI to prioritize booking calls/demos over discussing pricing in email.",
                  key: "prioritizeCalls",
                },
                {
                  icon: Sparkles,
                  title: "AI Dynamic Copy Adjustment",
                  badge: "Advanced",
                  desc: "Auto-rewrite message sequences when default copy underperforms.",
                  key: "aiAdjustCopyEnabled",
                },
              ].map((item, i) => (
                <div key={i} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 bg-muted/20 rounded-2xl border border-border/30 hover:border-border/60 transition-all gap-4">
                  <div className="flex gap-4 items-start">
                    <div className="p-3 rounded-2xl bg-background border border-border/40 shrink-0 mt-1">
                      <item.icon className="w-7 h-7 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm flex items-center gap-2">
                        {item.title}
                        <Badge variant="outline" className="text-[9px] uppercase font-bold text-primary border-primary/30">{item.badge}</Badge>
                      </h4>
                      <p className="text-sm text-muted-foreground max-w-md leading-relaxed mt-1">{item.desc}</p>
                    </div>
                  </div>
                  <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                    <Switch
                      checked={(formData as any)[item.key]}
                      onCheckedChange={c => handleFieldChange(item.key, c)}
                      className="data-[state=checked]:bg-primary"
                    />
                  </div>
                </div>
              ))}

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 bg-muted/20 rounded-2xl border border-border/30 hover:border-border/60 transition-all gap-4">
                <div className="flex gap-4 items-start">
                  <div className="p-3 rounded-2xl bg-background border border-border/40 shrink-0 mt-1">
                    <RefreshCw className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm flex items-center gap-2">
                      Historical Email Sync
                      <Badge variant="outline" className="text-[9px] uppercase font-bold text-primary border-primary/30">Mailboxes</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed mt-1">
                      Sync past 30 days of email history from connected domains.
                    </p>
                  </div>
                </div>
                <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => syncEmailMutation.mutate()}
                    disabled={syncEmailMutation.isPending}
                    className="rounded-xl font-bold h-11 border-primary/20 hover:bg-primary/5 text-primary"
                  >
                    {syncEmailMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
                    Sync Now
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Developer tab */}
        <TabsContent value="developer" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* API Keys */}
            <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm lg:col-span-2">
              <CardHeader className="pb-4 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    API Keys
                  </CardTitle>
                  <CardDescription>Authenticate API requests with a Bearer token. Keys start with <code className="text-primary font-mono text-xs">audnix_</code> for brand consistency. <a href="/developer" className="text-primary hover:underline font-bold" target="_blank" rel="noopener noreferrer">View full API docs →</a></CardDescription>
                </div>
                <Button
                  onClick={() => setShowCreateKey(true)}
                  className="rounded-xl font-bold text-xs h-10"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Key
                </Button>
              </CardHeader>
              <CardContent>
                {showCreateKey && (
                  <div className="mb-6 p-5 bg-muted/20 rounded-2xl border border-border/30 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Key Name</Label>
                        <Input
                          value={newKeyName}
                          onChange={e => setNewKeyName(e.target.value)}
                          placeholder="e.g. Production API"
                          className="rounded-xl h-11 bg-background border-border/40"
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newKeyName.trim() && !createApiKeyMutation.isPending) {
                              createApiKeyMutation.mutate(newKeyName.trim());
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Permissions</Label>
                        <Select value={newKeyScope} onValueChange={setNewKeyScope}>
                          <SelectTrigger className="rounded-xl h-11 bg-background border-border/40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="read_write">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                <span>Read & Write</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="read_only">
                              <div className="flex items-center gap-2">
                                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Read Only</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="ghost" onClick={() => { setShowCreateKey(false); setNewKeyName(""); setNewKeyScope("read_write"); }} className="rounded-xl">
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          if (newKeyName.trim()) createApiKeyMutation.mutate({ name: newKeyName.trim(), scope: newKeyScope });
                        }}
                        disabled={!newKeyName.trim() || createApiKeyMutation.isPending}
                        className="rounded-xl font-bold"
                      >
                        {createApiKeyMutation.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <>Generate Key</>}
                      </Button>
                    </div>
                  </div>
                )}

                {showNewKey && (
                  <div className="mb-6 p-5 bg-primary/5 rounded-2xl border border-primary/20 space-y-4">
                    <div className="flex items-start justify-between gap-2 text-primary">
                      <div className="flex items-center gap-2">
                        <Key className="h-5 w-5" />
                        <span className="font-bold text-sm">Your API Key</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowNewKey(null)}
                        className="h-6 w-6 rounded-full -mt-0.5 -mr-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Copy this key now. <strong>You won't be able to see it again</strong> for security reasons.
                      If you lose it, delete and recreate.
                    </p>
                    <div className="flex gap-2">
                      <code className="flex-1 p-3 bg-background rounded-xl border border-border/40 text-xs font-mono break-all select-all">
                        {showNewKey}
                      </code>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(showNewKey);
                          setCopiedField('API Key');
                          toast({
                            title: "API Key Copied",
                            description: "Paste it somewhere safe — you won't see it again.",
                          });
                          setTimeout(() => setCopiedField(null), 2000);
                        }}
                        className="rounded-xl shrink-0 h-11 w-11"
                      >
                        {copiedField === 'API Key' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                      <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                        Treat this like a password. Never share it or commit it to code.
                      </p>
                    </div>
                  </div>
                )}

                {apiKeys && apiKeys.length > 0 ? (
                  <div className="space-y-3">
                    {apiKeys.map((apiKey) => (
                      <ApiKeyRow
                        key={apiKey.id}
                        apiKey={apiKey}
                        onDelete={(id) => deleteApiKeyMutation.mutate(id)}
                        onEdit={(id, name) => editKeyNameMutation.mutate({ id, name })}
                        onCopy={(text) => {
                          navigator.clipboard.writeText(text);
                          toast({ title: "Copied", description: "API key fingerprint copied." });
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Key className="h-10 w-10 mx-auto mb-4 opacity-20" />
                    <p className="font-bold text-sm">No API keys yet</p>
                    <p className="text-xs mt-1">Create your first key to access the Audnix API programmatically.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Start Example */}
            <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-primary" />
                  Quick Start
                </CardTitle>
                <CardDescription>Use your API key with curl from anywhere — no IP whitelist needed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted/10 rounded-xl border border-border/20">
                  <code className="text-xs font-mono leading-relaxed block whitespace-pre-wrap text-foreground">{`# List your leads
curl -H "Authorization: Bearer audnix_..." \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/leads

# Get campaign stats
curl -H "Authorization: Bearer audnix_..." \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/outreach/campaigns

# Dashboard analytics
curl -H "Authorization: Bearer audnix_..." \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/dashboard/stats`}</code>
                </div>
                <div className="p-3 bg-primary/5 rounded-xl border border-primary/10">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">No IP restrictions.</strong> Your API key is your identity.
                    All endpoints return data scoped to your account. Auth/login endpoints are not accessible via API key.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* MCP Server */}
            <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm lg:col-span-2">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl flex items-center gap-2">
                  <Server className="h-5 w-5 text-primary" />
                  MCP Server
                </CardTitle>
                <CardDescription>Connect any LLM agent — Claude, GPT, Gemini, Cursor, and 5000+ more MCP-compatible clients.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* LLM Provider Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mr-2">Compatible:</span>
                  {[
                    ["Claude", "#d97706"],
                    ["Gemini", "#4285F4"],
                    ["ChatGPT", "#10a37f"],
                    ["Cursor", "#6c47ff"],
                    ["Copilot", "#0078d4"],
                    ["Cline", "#f97316"],
                    ["Continue", "#7c3aed"],
                    ["Windsurf", "#06b6d4"],
                    ["OpenCode", "#06b6d4"],
                    ["Claude Code", "#d97706"],
                  ].map(([name, color]) => (
                    <div key={name} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border/30" style={{backgroundColor: `${color}08`}}>
                      <div className="w-2 h-2 rounded-full" style={{backgroundColor: color}} />
                      <span className="text-[10px] font-bold text-muted-foreground">{name}</span>
                    </div>
                  ))}
                </div>

                {/* Server URL */}
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Server URL</Label>
                  <div className="flex gap-2">
                    <code className="flex-1 p-3 bg-muted/20 rounded-xl border border-border/40 text-xs font-mono select-all">
                      {typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://audnixai.com/api/mcp'}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopyToClipboard(`${window.location.origin}/api/mcp`, 'MCP URL')}
                      className="rounded-xl shrink-0 h-11 w-11"
                    >
                      {copiedField === 'MCP URL' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* Config Blocks for Different LLMs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      title: "Claude Desktop",
                      code: `{
  "mcpServers": {
    "audnix": {
      "url": "${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`,
                      key: "claude-config"
                    },
                    {
                      title: "VS Code / Cursor",
                      code: `{
  "mcp": {
    "servers": {
      "audnix": {
        "url": "${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  }
}`,
                      key: "vscode-config"
                    },
                    {
                      title: "OpenAI GPT (Custom GPT)",
                      code: `{
  "actions": [{
    "url": "${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    }
  }]
}`,
                      key: "openai-config"
                    },
                    {
                      title: "OpenCode / Cline",
                      code: `{
  "mcpServers": {
    "audnix": {
      "type": "url",
      "url": "${typeof window !== 'undefined' ? window.location.origin : 'https://audnixai.com'}/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`,
                      key: "opencode-config"
                    },
                  ].map((config) => (
                    <div key={config.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">{config.title}</h4>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-lg"
                          onClick={() => handleCopyToClipboard(config.code, config.key)}
                        >
                          {copiedField === config.key ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <div className="p-3 bg-muted/10 rounded-xl border border-border/20 relative group">
                        <code className="text-[10px] font-mono leading-relaxed block whitespace-pre-wrap text-foreground/80">{config.code}</code>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator className="bg-border/20" />

                {/* Available MCP Tools */}
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-3">Available Tools</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {[
                      { name: "get_leads", desc: "Query leads by status, date, category", danger: false },
                      { name: "get_campaigns", desc: "List campaigns and performance", danger: false },
                      { name: "get_analytics", desc: "Dashboard analytics data", danger: false },
                      { name: "get_inbox", desc: "Read inbox messages", danger: false },
                      { name: "send_message", desc: "Send outreach messages", danger: true },
                      { name: "manage_webhooks", desc: "Create & manage webhooks", danger: true },
                    ].map((tool) => (
                      <div key={tool.name} className="flex items-center gap-2 p-2.5 bg-muted/5 rounded-xl border border-border/20">
                        <div className={`p-1 rounded-lg ${tool.danger ? 'bg-amber-500/10' : 'bg-primary/10'}`}>
                          <Terminal className={`h-3 w-3 ${tool.danger ? 'text-amber-500' : 'text-primary'}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <code className="text-[10px] font-bold font-mono truncate">{tool.name}</code>
                            {tool.danger && <span className="text-[7px] font-bold uppercase text-amber-500 shrink-0">⚠️</span>}
                          </div>
                          <p className="text-[9px] text-muted-foreground truncate">{tool.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Permission Info */}
                <div className="p-4 bg-gradient-to-br from-primary/5 to-purple-500/5 rounded-2xl border border-primary/15">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm mb-1">Permissions & Safety</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        <strong className="text-foreground">Account deletion is NOT possible</strong> via MCP or API key — there is no tool or endpoint for it.
                        Deleting leads requires user confirmation. Auth, billing, and admin endpoints are blocked.
                        A skill file is available for LLM agents (<code className="text-[9px] font-mono bg-primary/10 px-1 rounded">audnix-mcp.md</code>) that explains all rules automatically.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Voice AI tab */}
        <TabsContent value="voice" className="space-y-6">
          <Card className="border-border/40 shadow-sm rounded-2xl bg-card/50 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <div className="flex justify-center mb-6">
                <div className="p-4 rounded-full bg-muted/30 border border-border/20">
                  <Construction className="w-12 h-12 text-muted-foreground" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-3">Coming Soon</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Voice AI & Cloning features are being upgraded and will be available soon.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Account tab */}
        <TabsContent value="account" className="space-y-6">
          <ScheduledDeletionCard />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}

function ScheduledDeletionCard() {
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const { toast } = useToast();

  const MAX_MS = 48 * 60 * 60 * 1000; // 48h max for progress bar

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/account/deletion-status");
      if (!res.ok) {
        if (res.status !== 404) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          setError(err.error || 'Failed to fetch deletion status');
        }
        return;
      }
      const data = await res.json();
      setScheduledAt(data.scheduledDeletionAt);
      setRemainingMs(data.remainingMs || 0);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch deletion status');
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!scheduledAt || remainingMs <= 0) return;
    const interval = setInterval(() => {
      setRemainingMs(prev => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [scheduledAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

  const handleScheduleDeletion = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/account/schedule-deletion");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || err.message || 'Failed to schedule deletion');
      }
      const data = await res.json();
      setScheduledAt(data.scheduledAt);
      setRemainingMs(Math.min(MAX_MS, new Date(data.scheduledAt).getTime() - Date.now()));
      toast({ title: "Deletion scheduled" });
    } catch (e: any) {
      setError(e.message);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDeletion = async () => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/account/cancel-deletion");
      setScheduledAt(null);
      setRemainingMs(0);
      toast({ title: "Deletion cancelled", description: "Your account is safe." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!scheduledAt || remainingMs > 0 || deletingNow) return;
    setDeletingNow(true);
    const timer = setTimeout(() => {
      (async () => {
        try {
          await apiRequest("DELETE", "/api/account");
          window.location.href = "/";
        } catch (e: any) {
          toast({ title: "Deletion failed", description: e.message, variant: "destructive" });
          setDeletingNow(false);
        }
      })();
    }, 3000);
    return () => clearTimeout(timer);
  }, [scheduledAt, remainingMs, deletingNow]);

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          Delete account
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {deletingNow ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-6 rounded-2xl bg-gradient-to-br from-destructive/10 to-background border border-destructive/30 text-center space-y-3"
          >
            <motion.div
              animate={{ y: [0, -10, 0], opacity: [1, 0.5, 0] }}
              transition={{ duration: 2.5, ease: "easeInOut" }}
              className="text-4xl"
            >
              🕊️
            </motion.div>
            <p className="text-sm font-semibold text-destructive">Goodbye for now</p>
            <p className="text-xs text-muted-foreground">Clearing your data and logging you out...</p>
          </motion.div>
        ) : scheduledAt ? (
          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-2xl bg-destructive/5 border border-destructive/20"
            >
              <p className="text-xs font-medium text-destructive/80 mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                Scheduled for deletion
              </p>
              <div className="flex items-center gap-3 mb-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
                >
                  <Clock className="h-5 w-5 text-destructive shrink-0" />
                </motion.div>
                <div>
                  <motion.p
                    key={`${hours}-${minutes}-${seconds}`}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-lg font-bold tabular-nums text-destructive"
                  >
                    {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                  </motion.p>
                  <p className="text-[10px] text-muted-foreground">until account is permanently deleted</p>
                </div>
              </div>
              <motion.div className="h-1.5 rounded-full bg-destructive/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-destructive"
                  initial={{ width: '100%' }}
                  animate={{ width: `${Math.max(0, (remainingMs / MAX_MS) * 100)}%` }}
                  transition={{ duration: 1 }}
                />
              </motion.div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelDeletion}
                disabled={loading}
                className="w-full gap-1.5"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Cancel deletion
              </Button>
            </motion.div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <p className="text-xs text-muted-foreground">
              Your account will be permanently deleted within 24-48 hours. You can cancel at any time.
            </p>
            {error && (
              <motion.p
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs text-destructive font-medium"
              >
                {error}
              </motion.p>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={loading} className="gap-1.5">
                  <Trash2 className="h-4 w-4" />
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="p-6 pt-8 gap-4">
                <AlertDialogHeader className="pr-6 space-y-2">
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <p>Your account will be permanently deleted within 24-48 hours.</p>
                    <p className="text-muted-foreground/60">You can cancel anytime before the deletion completes. All your data will be permanently removed.</p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-3 pt-2">
                  <AlertDialogCancel className="flex-1">Keep my account</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleScheduleDeletion}
                    className="bg-destructive hover:bg-destructive/90 flex-1"
                  >
                    Yes, delete my account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeyRow({
  apiKey,
  onDelete,
  onEdit,
  onCopy,
}: {
  apiKey: ApiKey;
  onDelete: (id: string) => void;
  onEdit: (id: string, name: string) => void;
  onCopy: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(apiKey.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  return (
    <div className="flex items-center justify-between p-4 bg-muted/10 rounded-xl border border-border/20 hover:border-border/40 transition-all group">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <Key className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="h-8 rounded-lg text-sm font-bold bg-background border-border/40 max-w-[200px]"
                onKeyDown={e => {
                  if (e.key === 'Enter' && editName.trim()) {
                    onEdit(apiKey.id, editName.trim());
                    setEditing(false);
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => {
                if (editName.trim() && editName !== apiKey.name) {
                  onEdit(apiKey.id, editName.trim());
                }
                setEditing(false);
              }}>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="font-bold text-sm truncate">{apiKey.name}</p>
              <button
                onClick={() => { setEditName(apiKey.name); setEditing(true); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
              >
                <Edit3 className="h-3 w-3 text-muted-foreground" />
              </button>
              <Badge className={`text-[8px] font-bold uppercase px-1.5 py-0 border-0 ${apiKey.scope === 'read_only' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                {apiKey.scope === 'read_only' ? 'Read' : 'Read/Write'}
              </Badge>
            </div>
          )}
          <div className="flex items-center gap-3 mt-0.5 min-w-0">
            <code className="text-xs font-mono text-muted-foreground/70 truncate">{apiKey.key}</code>
            <button
              onClick={() => onCopy(apiKey.key)}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Copy className="h-3 w-3 text-muted-foreground/40 hover:text-foreground" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            Created {apiKey.createdAt ? new Date(apiKey.createdAt).toLocaleDateString() : 'Unknown'}
            {apiKey.lastUsedAt ? ` · Used ${new Date(apiKey.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
          </p>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl text-muted-foreground hover:text-destructive shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="rounded-2xl max-w-sm p-6 pt-8 gap-4">
          <AlertDialogHeader className="pr-6 space-y-2">
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              Delete API Key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke <strong>{apiKey.name}</strong>. Any services using this key will immediately lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 pt-2">
            <AlertDialogCancel className="rounded-xl flex-1">Keep Key</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(apiKey.id)}
              className="rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold flex-1"
            >
              Delete Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
