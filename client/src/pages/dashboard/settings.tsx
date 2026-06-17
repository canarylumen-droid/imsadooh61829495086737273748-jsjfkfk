import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Loader2, Upload, Mic, Settings, Save, ShieldCheck, Globe, Palette, Lock, Brain, Mail, RefreshCw, Activity, CheckCircle2, Plus, Phone, ArrowLeft, Building2, Sparkles, Copy, Check } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCanAccessVoiceNotes } from "@/hooks/use-access-gate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { PdfIcon, VoiceIcon } from "@/components/ui/CustomIcons";
import { BrandKnowledgeBase } from "@/components/admin/BrandKnowledgeBase";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

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

export default function SettingsPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: user, isLoading } = useQuery<UserProfile | null>({ queryKey: ["/api/user/profile"] });
  const { data: smtpData } = useQuery<any[]>({ queryKey: ["/api/smtp/settings"] });
  const { data: customEmailStatus } = useQuery<any>({ queryKey: ["/api/custom-email/status"] });
  const { canAccess: canAccessVoiceNotes } = useCanAccessVoiceNotes();

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
      // Ensure we nest config if it's in the data
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

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch('/api/user/avatar', { method: 'POST', body: formData });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/user/profile"], (old: any) => ({ ...old, avatar: data.avatar }));
      toast({ title: "Avatar Updated" });
    }
  });

  const uploadPDFMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('pdf', file);
      const res = await fetch('/api/pdf/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Intelligence Memory Synced", description: "Your brand intelligence has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    }
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

  if (isLoading || !user) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <PageWrapper className="space-y-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="rounded-md font-bold text-[10px] uppercase tracking-wider bg-primary/10 text-primary border-primary/20">
              Account Settings
            </Badge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Settings
          </h1>
        </div>
        {hasChanges && (
          <Button
            onClick={() => saveMutation.mutate(formData)}
            className="rounded-xl px-8 h-12 font-bold shadow-lg shadow-primary/20"
          >
            {saveMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        )}
      </div>

      <Tabs defaultValue="profile" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="bg-muted p-1 rounded-xl mb-8 w-full flex overflow-x-auto no-scrollbar justify-start md:justify-center">
          <TabsTrigger value="profile" className="flex-1 rounded-lg px-4 md:px-8 py-2 font-bold text-xs md:text-sm whitespace-nowrap">Profile</TabsTrigger>
          <TabsTrigger value="brand" className="flex-1 rounded-lg px-4 md:px-8 py-2 font-bold text-xs md:text-sm whitespace-nowrap">Intelligence Memory</TabsTrigger>
          <TabsTrigger value="ai" className="flex-1 rounded-lg px-4 md:px-8 py-2 font-bold text-xs md:text-sm whitespace-nowrap">Automation</TabsTrigger>
          <TabsTrigger value="dns" className="flex-1 rounded-lg px-4 md:px-8 py-2 font-bold text-xs md:text-sm whitespace-nowrap flex items-center gap-2">
            <ShieldCheck className="h-3 w-3" /> DNS Setup
          </TabsTrigger>
          <TabsTrigger value="voice" className="flex-1 rounded-lg px-4 md:px-8 py-2 font-bold text-xs md:text-sm whitespace-nowrap flex items-center gap-2">
            <Mic className="h-3 w-3" /> Voice AI
            {!canAccessVoiceNotes && <Lock className="h-3 w-3 opacity-60" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ResponsiveGrid className="grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="border-border/50 shadow-sm rounded-2xl">
              <CardContent className="flex flex-col items-center p-8">
                <div className="relative group mb-6">
                  <Avatar className="h-32 w-32 border-2 border-border shadow-md">
                    <AvatarImage src={user.avatar} className="object-cover" />
                    <AvatarFallback className="text-3xl bg-muted text-muted-foreground font-bold">
                      {user.name?.[0]?.toUpperCase() || 'O'}
                    </AvatarFallback>
                  </Avatar>
                  <Button
                    size="icon"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 rounded-full shadow-lg border border-border"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadAvatarMutation.mutate(e.target.files[0])} />
                </div>
                <div className="text-center space-y-1 mb-6">
                  <h3 className="text-xl font-bold">{user.name || 'Set your name'}</h3>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <Badge variant="outline" className="px-4 py-1 rounded-full font-bold uppercase tracking-wider text-[10px]">
                  {user.plan || 'Free'} Plan
                </Badge>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 border-border/50 shadow-sm rounded-2xl">
              <CardHeader>
                <CardTitle className="text-xl">Profile Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <ResponsiveGrid className="grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Full Name</Label>
                    <Input
                      value={formData.name}
                      onChange={e => handleFieldChange('name', e.target.value)}
                      className="rounded-xl h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Username</Label>
                    <Input
                      value={formData.username}
                      onChange={e => handleFieldChange('username', e.target.value)}
                      className="rounded-xl h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Company</Label>
                    <Input
                      value={formData.company}
                      onChange={e => handleFieldChange('company', e.target.value)}
                      className="rounded-xl h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Calendar Booking Link</Label>
                      {(user as any).calendlyAccessToken ? (
                        <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest text-emerald-500 border-emerald-500/20 bg-emerald-500/5 h-5">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Calendly Connected
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
                          <Plus className="h-2.5 w-2.5 mr-1" /> Connect Calendly
                        </Button>
                      )}
                    </div>
                    <Input
                      value={formData.calendarLink}
                      onChange={e => handleFieldChange('calendarLink', e.target.value)}
                      placeholder="https://calendly.com/your-link"
                      className="rounded-xl h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Default Checkout Link</Label>
                    <Input
                      value={formData.defaultPaymentLink}
                      onChange={e => handleFieldChange('defaultPaymentLink', e.target.value)}
                      placeholder="Enter Your Payment link (e.g. Stripe)"
                      className="rounded-xl h-11 border-primary/30 focus-visible:ring-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Used autonomously when a lead explicitly asks for an invoice or agrees to buy on call.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Offer Description / Pricing</Label>
                    <Input
                      value={formData.offerDescription}
                      onChange={e => handleFieldChange('offerDescription', e.target.value)}
                      placeholder="e.g. Done-for-you leads at $3,000/month"
                      className="rounded-xl h-11 border-primary/30 focus-visible:ring-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">AI will use this exact offer description instead of guessing.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Default Deal Value ($)</Label>
                    <Input
                      type="number"
                      value={formData.offerValue}
                      onChange={e => handleFieldChange('offerValue', parseFloat(e.target.value) || 0)}
                      placeholder="e.g. 5000"
                      className="rounded-xl h-11 border-primary/30 focus-visible:ring-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Used as the baseline monetary value for new won deals.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Timezone</Label>
                    <Select value={formData.timezone} onValueChange={v => handleFieldChange('timezone', v)}>
                      <SelectTrigger className="rounded-xl h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                        <SelectItem value="Europe/London">London (GMT)</SelectItem>
                        <SelectItem value="Africa/Lagos">West Africa Time (WAT / Lagos)</SelectItem>
                        <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                        <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </ResponsiveGrid>

                <div className="space-y-6 pt-6 border-t border-border/40">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-bold uppercase tracking-widest px-3 h-6 flex items-center">Double Offer System</Badge>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Enable fallback offers for hesitant leads</p>
                    </div>
                    <Switch 
                      checked={formData.doubleOfferEnabled}
                      onCheckedChange={c => handleFieldChange('doubleOfferEnabled', c)}
                    />
                  </div>
                  
                  {formData.doubleOfferEnabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-300 bg-primary/5 p-6 rounded-2xl border border-primary/10">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Secondary Offer Description</Label>
                        <Input
                          value={formData.offerDescription2}
                          onChange={e => handleFieldChange('offerDescription2', e.target.value)}
                          placeholder="e.g. Lite version at $1,500/month"
                          className="rounded-xl h-11 border-primary/20 focus-visible:ring-primary bg-background"
                        />
                        <p className="text-[10px] text-muted-foreground">Used autonomously as a downsell when a lead rejects the primary offer.</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-2">Secondary Deal Value ($)</Label>
                        <Input
                          type="number"
                          value={formData.offerValue2}
                          onChange={e => handleFieldChange('offerValue2', parseFloat(e.target.value) || 0)}
                          placeholder="e.g. 1500"
                          className="rounded-xl h-11 border-primary/20 focus-visible:ring-primary bg-background"
                        />
                        <p className="text-[10px] text-muted-foreground">Monetary baseline for the downsell offer.</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </ResponsiveGrid>
        </TabsContent>

        <TabsContent value="brand" className="space-y-6">
          <BrandKnowledgeBase embedded={true} />
        </TabsContent>

        <TabsContent value="dns" className="space-y-6">
          <Card className="border-border/50 shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="text-xl">DNS Configuration</CardTitle>
              <CardDescription>Add these TXT records to your DNS provider to ensure optimal email deliverability.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-500" />
                      <h4 className="font-bold text-sm">SPF Record</h4>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-xs font-medium"
                      onClick={() => handleCopyToClipboard('v=spf1 include:_spf.google.com ~all', 'SPF Record')}
                    >
                      {copiedField === 'SPF Record' ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copiedField === 'SPF Record' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <div className="bg-background border border-border rounded-lg p-3 font-mono text-xs text-muted-foreground break-all">
                    v=spf1 include:_spf.google.com ~all
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Add this as a TXT record for your domain to authorize Gmail to send emails on your behalf.</p>
                </div>

                <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-blue-500" />
                      <h4 className="font-bold text-sm">DKIM Record</h4>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-xs font-medium"
                      onClick={() => handleCopyToClipboard('v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY', 'DKIM Record')}
                    >
                      {copiedField === 'DKIM Record' ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copiedField === 'DKIM Record' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <div className="bg-background border border-border rounded-lg p-3 font-mono text-xs text-muted-foreground break-all">
                    v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Add this as a TXT record for selector._domainkey.yourdomain.com. Replace YOUR_PUBLIC_KEY with your actual DKIM key from Gmail.</p>
                </div>

                <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-purple-500" />
                      <h4 className="font-bold text-sm">DMARC Record</h4>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-xs font-medium"
                      onClick={() => handleCopyToClipboard('v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com', 'DMARC Record')}
                    >
                      {copiedField === 'DMARC Record' ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copiedField === 'DMARC Record' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <div className="bg-background border border-border rounded-lg p-3 font-mono text-xs text-muted-foreground break-all">
                    v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Add this as a TXT record for _dmarc.yourdomain.com to enable DMARC policy reporting.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          <Card className="border-border/50 shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="text-xl">Automation Controls</CardTitle>
              <CardDescription>Manage how the system interact with leads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-gradient-to-br from-primary/5 to-purple-500/5 rounded-2xl border border-primary/20 hover:border-primary/40 transition-all gap-4">
                <div className="flex gap-4">
                  <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 shrink-0">
                    <Brain className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-black text-base uppercase tracking-tight flex items-center gap-2">
                      AI Autonomous Orchestrator
                      <Badge className="bg-primary text-black text-[9px] font-black uppercase px-2 py-0 border-0">V3.5</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Enable the global AI engine to handle outreach, replies, and follow-ups 24/7.
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

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-muted/30 rounded-2xl border border-border hover:border-border/80 transition-all gap-4">
                <div className="flex gap-4">
                  <div className="p-3 rounded-2xl bg-background border border-border shrink-0">
                    <Mail className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-base flex items-center gap-2">
                      Inbound Lead Discovery
                      <Badge variant="outline" className="text-[9px] uppercase font-bold text-primary border-primary">CRM Controls</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Automatically create leads in your CRM when unknown contacts send real-time inbound emails to your connected mailboxes. If disabled, Audnix will only sync threads for existing database contacts.
                    </p>
                  </div>
                </div>
                <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                  <Switch
                    checked={formData.discoverInboundLeads}
                    onCheckedChange={c => handleFieldChange('discoverInboundLeads', c)}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-muted/30 rounded-2xl border border-border hover:border-border/80 transition-all gap-4">
                <div className="flex gap-4">
                  <div className="p-3 rounded-2xl bg-background border border-border shrink-0">
                    <Phone className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-base flex items-center gap-2">
                      Prioritize Booked Calls
                      <Badge variant="outline" className="text-[9px] uppercase font-bold text-primary border-primary">Closing Strategy</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Force the AI to prioritize getting leads onto a booked call or demo instead of discussing pricing or negotiating discounts directly over email/DMs.
                    </p>
                  </div>
                </div>
                <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                  <Switch
                    checked={formData.prioritizeCalls}
                    onCheckedChange={c => handleFieldChange('prioritizeCalls', c)}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>


              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-muted/30 rounded-2xl border border-border hover:border-border/80 transition-all gap-4">
                <div className="flex gap-4">
                  <div className="p-3 rounded-2xl bg-background border border-border shrink-0">
                    <Sparkles className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-base flex items-center gap-2">
                      AI Dynamic Copy Adjustment
                      <Badge variant="outline" className="text-[9px] uppercase font-bold text-primary border-primary">Advanced</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Enable the AI to autonomously rewrite message sequences for specific leads if the default copy is performing poorly or doesn't match the sentiment.
                    </p>
                  </div>
                </div>
                <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                  <Switch
                    checked={formData.aiAdjustCopyEnabled}
                    onCheckedChange={c => handleFieldChange('aiAdjustCopyEnabled', c)}
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-muted/30 rounded-2xl border border-border hover:border-border/80 transition-all gap-4">
                <div className="flex gap-4">
                  <div className="p-3 rounded-2xl bg-background border border-border shrink-0">
                    <RefreshCw className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-base flex items-center gap-2">
                      Historical Email Sync
                      <Badge variant="outline" className="text-[9px] uppercase font-bold text-primary border-primary">Mailboxes</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Manually synchronize past email history (up to 30 days) from connected custom domains to populate your inbox and lead database.
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
                    Sync History Now
                  </Button>
                </div>
              </div>


              <div className="p-6 bg-muted/30 rounded-xl border border-border">
                <div className="flex justify-between mb-4">
                  <h4 className="font-bold text-sm">Response Accuracy Threshold</h4>
                  <span className="text-sm font-bold text-primary">{formData.pdfConfidenceThreshold}%</span>
                </div>
                <Slider
                  value={[formData.pdfConfidenceThreshold]}
                  min={50}
                  max={100}
                  step={1}
                  onValueChange={(val) => handleFieldChange('pdfConfidenceThreshold', val[0])}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-3">
                  Minimum confidence score required for the system to reply without human review.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice" className="space-y-6">
          <Card className="border-border/50 shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="text-xl">Voice AI & Cloning</CardTitle>
              <CardDescription>Configure AI-generated voice notes for highly-personalized outreach.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!canAccessVoiceNotes && (
                <div className="p-6 bg-primary/5 border border-primary/20 rounded-2xl flex flex-col items-center text-center gap-4 mb-4">
                  <div className="p-3 bg-primary/10 rounded-full">
                    <Lock className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">Pro Feature</h4>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Voice AI and Voice Cloning are only available on Growth and Performance plans.
                    </p>
                  </div>
                  <Button variant="default" className="rounded-xl px-6" asChild>
                    <Link href="/pricing">View Plans</Link>
                  </Button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 bg-gradient-to-br from-primary/5 to-purple-500/5 rounded-2xl border border-primary/20 hover:border-primary/40 transition-all gap-4">
                <div className="flex gap-4">
                  <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 shrink-0">
                    <VoiceIcon className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-base">Voice Engagement</h4>
                    <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Automatically send personalized voice notes via Instagram DM for 10x higher response rates.
                    </p>
                  </div>
                </div>
                <div className="sm:shrink-0 w-full sm:w-auto flex justify-end">
                  <Switch
                    checked={formData.voiceNotesEnabled && canAccessVoiceNotes}
                    onCheckedChange={c => canAccessVoiceNotes && handleFieldChange('voiceNotesEnabled', c)}
                    disabled={!canAccessVoiceNotes}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-2 border-border/50 shadow-none bg-muted/20">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <h4 className="font-bold text-sm">Voice Identity (Clone)</h4>
                        <p className="text-xs text-muted-foreground mt-1">Train the AI with your own voice for authentic engagement.</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => voiceInputRef.current?.click()}
                        disabled={cloneVoiceMutation.isPending || !canAccessVoiceNotes}
                        className="h-9 px-4 rounded-lg font-bold border-primary/20 hover:bg-primary/5 text-primary"
                      >
                        {cloneVoiceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                        {user.metadata?.voiceCloneId ? 'Update Identity' : 'Clone Voice'}
                      </Button>
                      <input
                        ref={voiceInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept="audio/*"
                        onChange={e => e.target.files && cloneVoiceMutation.mutate(e.target.files)}
                      />
                    </div>

                    {user.metadata?.voiceCloneId ? (
                      <div className="flex items-center gap-4 p-4 bg-primary/10 rounded-xl border border-primary/20 mb-2">
                        <div className="p-2 bg-primary/20 rounded-full text-primary">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-primary">Identity Verified</p>
                          <p className="text-[10px] text-muted-foreground">Successfully cloned and ready for engagement.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 text-center border-2 border-dashed border-border rounded-xl">
                        <Mic className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                        <p className="text-xs text-muted-foreground">Upload 1-3 voice samples (30s each) to begin.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/50 shadow-none bg-muted/20">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex justify-between mb-1">
                      <h4 className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground">Monthly Capacity</h4>
                      <span className="text-[11px] font-bold text-primary">{voiceUsage?.percentage || 0}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden border border-border/50">
                      <div
                        className="h-full bg-primary transition-all duration-500 shadow-[0_0_10px_rgba(var(--primary),0.5)]"
                        style={{ width: `${voiceUsage?.percentage || 0}%` }}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px] font-medium">
                        <span className="text-muted-foreground">Minutes Used</span>
                        <span className="text-foreground">{voiceUsage?.used.toFixed(2) || 0}m</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-medium">
                        <span className="text-muted-foreground">Remaining</span>
                        <span className="text-emerald-500 font-bold">{voiceUsage?.remaining.toFixed(2) || 0}m</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}
