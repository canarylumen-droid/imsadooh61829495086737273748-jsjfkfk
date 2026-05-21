import { useState, useEffect, useRef } from "react";
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
import { User, Loader2, Upload, Mic, Settings, Save, ShieldCheck, Globe, Palette, Lock } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCanAccessVoiceNotes } from "@/hooks/use-access-gate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { PdfIcon, VoiceIcon } from "@/components/ui/CustomIcons";

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
}

export default function SettingsPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("profile");
  const [hasChanges, setHasChanges] = useState(false);

  const { canAccess: canAccessVoiceNotes } = useCanAccessVoiceNotes();
  const { data: user, isLoading } = useQuery<UserProfile | null>({ queryKey: ["/api/user/profile"] });

  const [formData, setFormData] = useState({
    name: "",
    username: "",
    company: "",
    timezone: "America/New_York",
    ctaLink: "",
    ctaText: "",
    calendarLink: "",
    voiceNotesEnabled: true
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
        voiceNotesEnabled: user.voiceNotesEnabled ?? true
      });
    }
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("PUT", "/api/user/profile", data),
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
      toast({ title: "Knowledge Base Updated", description: "Brand materials uploaded successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    }
  });

  const handleFieldChange = (key: string, val: any) => {
    setFormData(prev => ({ ...prev, [key]: val }));
    setHasChanges(true);
  };

  if (isLoading || !user) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="space-y-10">
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
        <TabsList className="bg-muted p-1 rounded-xl mb-8">
          <TabsTrigger value="profile" className="rounded-lg px-8 py-2 font-bold text-sm">Profile</TabsTrigger>
          <TabsTrigger value="brand" className="rounded-lg px-8 py-2 font-bold text-sm">Brand Guidelines</TabsTrigger>
          <TabsTrigger value="ai" className="rounded-lg px-8 py-2 font-bold text-sm">Automation</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Timezone</Label>
                    <Select value={formData.timezone} onValueChange={v => handleFieldChange('timezone', v)}>
                      <SelectTrigger className="rounded-xl h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                        <SelectItem value="Europe/London">London (GMT)</SelectItem>
                        <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                        <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="brand" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="border-border/50 shadow-sm rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Palette className="h-5 w-5 text-primary" />
                  Knowledge Base
                </CardTitle>
                <CardDescription>Upload brand materials to train your AI.</CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-0">
                <div
                  className="group border-2 border-dashed border-border hover:border-primary/50 transition-all rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer bg-muted/30"
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <div className="mb-6">
                    <PdfIcon className="w-12 h-12" />
                  </div>
                  <h3 className="font-bold mb-2">Upload Brand PDF</h3>
                  <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                    Guides, sales scripts, or brand decks used for AI training.
                  </p>
                  <input ref={pdfInputRef} type="file" className="hidden" accept=".pdf" onChange={e => e.target.files?.[0] && uploadPDFMutation.mutate(e.target.files[0])} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-sm rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Globe className="h-5 w-5 text-primary" />
                  Primary Action
                </CardTitle>
                <CardDescription>Direct leads to your booking link or website.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">CTA Link</Label>
                  <Input
                    placeholder="https://cal.com/meeting"
                    value={formData.ctaLink}
                    onChange={e => handleFieldChange('ctaLink', e.target.value)}
                    className="rounded-xl h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">CTA Text</Label>
                  <Input
                    placeholder="Book a Strategy Call"
                    value={formData.ctaText}
                    onChange={e => handleFieldChange('ctaText', e.target.value)}
                    className="rounded-xl h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Calendar Link (for AI Booking)</Label>
                  <Input
                    placeholder="https://calendly.com/your-link"
                    value={formData.calendarLink}
                    onChange={e => handleFieldChange('calendarLink', e.target.value)}
                    className="rounded-xl h-11"
                  />
                  <p className="text-[10px] text-muted-foreground italic">AI will use this link to book calls with leads.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          <Card className="border-border/50 shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="text-xl">Automation Controls</CardTitle>
              <CardDescription>Manage how the system interact with leads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-6 bg-muted/30 rounded-xl border border-border">
                <div className="flex gap-4">
                  <div className="p-3 rounded-xl bg-background border border-border">
                    <VoiceIcon className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="font-bold flex items-center gap-2">
                      Voice Engagement
                      {canAccessVoiceNotes ? <Badge className="bg-primary hover:bg-primary text-black text-[9px] font-bold">Pro Feature</Badge> : <Lock className="h-3 w-3 text-muted-foreground" />}
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-md">
                      AI-generated voice notes for Instagram engagement.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={formData.voiceNotesEnabled && canAccessVoiceNotes}
                  onCheckedChange={c => canAccessVoiceNotes && handleFieldChange('voiceNotesEnabled', c)}
                  disabled={!canAccessVoiceNotes}
                />
              </div>

              <div className="p-6 bg-muted/30 rounded-xl border border-border">
                <div className="flex justify-between mb-4">
                  <h4 className="font-bold text-sm">Response Accuracy Threshold</h4>
                  <span className="text-sm font-bold text-primary">85%</span>
                </div>
                <div className="h-1.5 bg-background rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: '85%' }} />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Minimum confidence score required for the system to reply without human review.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
