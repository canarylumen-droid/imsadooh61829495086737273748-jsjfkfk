import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, Send, Wand2, Mail, Clock, Users, Smartphone, Monitor } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface OutreachConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    leads: Array<{ id?: string; name: string; email: string; company?: string }>;
    onSuccess?: () => void;
}

export default function OutreachConfigModal({ isOpen, onClose, leads, onSuccess }: OutreachConfigModalProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
    const [previewDevice, setPreviewDevice] = useState<"ios" | "android">("ios");

    // Campaign Config
    const [dailyLimit, setDailyLimit] = useState(50);
    const [followUpDays, setFollowUpDays] = useState("3");

    // Email Template
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");

    // Follow-up Template 1
    const [followUpSubject, setFollowUpSubject] = useState("");
    const [followUpBody, setFollowUpBody] = useState("");

    // Follow-up Template 2
    const [followUpSubject2, setFollowUpSubject2] = useState("");
    const [followUpBody2, setFollowUpBody2] = useState("");

    // Auto-Reply Template
    const [autoReplyBody, setAutoReplyBody] = useState("");
    const [campaignName, setCampaignName] = useState("");
    const [showLeadRecoveryPreflight, setShowLeadRecoveryPreflight] = useState(false);
    const [leadRecoveryWarning, setLeadRecoveryWarning] = useState("");

    // Load saved state
    useEffect(() => {
        const saved = localStorage.getItem("outreach_draft");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setCampaignName(parsed.campaignName || "");
                setSubject(parsed.subject || "Quick question about {{company}}");
                setBody(parsed.body || `Hi {{firstName}},\n\nI came across {{company}} and was impressed by what you're building.\n\nWe help companies like yours scale their outreach and close more deals with AI-powered automation.\n\nWould you be open to a quick chat this week?\n\nBest,\n[Your Name]`);
                setFollowUpSubject(parsed.followUpSubject || "Re: {{subject}}");
                setFollowUpBody(parsed.followUpBody || `Hi {{firstName}},\n\nJust wanted to follow up on my previous email. I know you're busy, but I'd love to connect if you have a few minutes.\n\nLet me know if this week works?\n\nBest,\n[Your Name]`);
                setFollowUpSubject2(parsed.followUpSubject2 || "Re: {{subject}}");
                setFollowUpBody2(parsed.followUpBody2 || `Hi {{firstName}},\n\nI know you're busy, so I'll stop pestering you. Here is a link to our site if you ever need us.\n\nBest,\n[Your Name]`);
                setDailyLimit(parsed.dailyLimit || 50);
                setFollowUpDays(parsed.followUpDays || "3");
                setAutoReplyBody(parsed.autoReplyBody || `Hi {{firstName}},\n\nThanks for getting back to me! I'm currently in a few meetings but saw your message. \n\nI'll take a look and get back to you with a proper response in just a bit. \n\nIn the meantime, feel free to check out our site if you have any questions!\n\nBest,\n[Your Name]`);
            } catch (e) {
                console.error("Failed to load draft", e);
            }
        } else {
            // Defaults if nothing saved
            setCampaignName("");
            setSubject("Quick question about {{company}}");
            setBody(`Hi {{firstName}},\n\nI came across {{company}} and was impressed by what you're building.\n\nWe help companies like yours scale their outreach and close more deals with AI-powered automation.\n\nWould you be open to a quick chat this week?\n\nBest,\n[Your Name]`);
            setFollowUpSubject("Re: {{subject}}");
            setFollowUpBody(`Hi {{firstName}},\n\nJust wanted to follow up on my previous email. I know you're busy, but I'd love to connect if you have a few minutes.\n\nLet me know if this week works?\n\nBest,\n[Your Name]`);
            setFollowUpSubject2("Re: {{subject}}");
            setFollowUpBody2(`Hi {{firstName}},\n\nI know you're busy, so I'll stop pestering you. Here is a link to our site if you ever need us.\n\nBest,\n[Your Name]`);
            setAutoReplyBody(`Hi {{firstName}},\n\nThanks for getting back to me! I'm currently in a few meetings but saw your message. \n\nI'll take a look and get back to you with a proper response in just a bit. \n\nIn the meantime, feel free to check out our site if you have any questions!\n\nBest,\n[Your Name]`);
        }
    }, []);

    // Save state on change
    useEffect(() => {
        const state = { campaignName, subject, body, followUpSubject, followUpBody, followUpSubject2, followUpBody2, autoReplyBody, dailyLimit, followUpDays };
        localStorage.setItem("outreach_draft", JSON.stringify(state));
    }, [campaignName, subject, body, followUpSubject, followUpBody, followUpSubject2, followUpBody2, autoReplyBody, dailyLimit, followUpDays]);

    const handleAIDraft = async () => {
        setIsGeneratingAI(true);
        try {
            const res = await apiRequest("POST", "/api/outreach/preview", {
                lead: leads[0] || { name: "Sample", company: "Company", email: "test@example.com" }
            });
            const data = await res.json();
            if (data.success && data.preview) {
                setSubject(data.preview.subject || subject);
                setBody(data.preview.body || body);
                toast({ title: "AI Draft Generated", description: "Email template updated with AI suggestion." });
            }
        } catch (error) {
            toast({ title: "AI generation failed", variant: "destructive" });
        } finally {
            setIsGeneratingAI(false);
        }
    };

    const handleLaunch = async (skipLeadRecoveryPreflight = false) => {
        if (leads.length === 0) {
            toast({ title: "No leads", description: "Please import leads first.", variant: "destructive" });
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
            // Create campaign with leads
            const res = await apiRequest("POST", "/api/outreach/campaigns", {
                name: campaignName || `Import Campaign - ${new Date().toLocaleDateString()}`,
                leads: leads.filter(l => l.id).map(l => l.id),
                config: {
                    dailyLimit,
                    minDelayMinutes: 2,
                    maxDelayMinutes: 4,
                    followUpDelayDays: parseInt(followUpDays)
                },
                template: {
                    subject,
                    body,
                    followups: [
                        { delayDays: parseInt(followUpDays), subject: followUpSubject, body: followUpBody },
                        { delayDays: parseInt(followUpDays) + 4, subject: followUpSubject2, body: followUpBody2 }
                    ],
                    autoReplyBody
                }
            });

            const campaign = await res.json();

            // Start the campaign
            await apiRequest("POST", `/api/outreach/campaigns/${campaign.id}/start`, {});

            toast({
                title: "Campaign Launched!",
                description: `${campaign.addedLeads ?? leads.length} leads queued. Sending ${dailyLimit}/day with ${followUpDays}-day follow-ups.`
            });

            onSuccess?.();
            onClose();
        } catch (error: any) {
            console.error("Campaign launch error:", error);
            toast({
                title: "Failed to launch campaign",
                description: error.message || "Please try again",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    const renderPreview = (subj: string, content: string) => {
        const sampleLead = leads[0] || { name: "John Doe", company: "Acme Inc" };
        const filledSubject = subj.replace(/{{name}}/g, sampleLead.name).replace(/{{firstName}}/g, sampleLead.name.split(' ')[0]).replace(/{{company}}/g, sampleLead.company || 'Acme').replace(/{{subject}}/g, subject);
        const filledBody = content.replace(/{{name}}/g, sampleLead.name).replace(/{{firstName}}/g, sampleLead.name.split(' ')[0]).replace(/{{company}}/g, sampleLead.company || 'Acme').replace(/{{subject}}/g, subject);

        return (
            <div className="flex justify-center h-full items-center p-4 bg-gray-100/50 rounded-xl">
                <div className={`relative bg-background border-4 border-gray-800 rounded-[3rem] shadow-2xl overflow-hidden ${previewDevice === 'ios' ? 'w-[320px] h-[600px]' : 'w-[360px] h-[640px] border-gray-700 rounded-[2.5rem]'}`}>
                    {/* Notch/Camera */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-32 bg-gray-800 rounded-b-xl z-20" />

                    {/* Status Bar */}
                    <div className="h-8 bg-background flex items-center justify-between px-6 text-[10px] font-bold select-none pt-2">
                        <span>9:41</span>
                        <div className="flex gap-1">
                            <div className="w-4 h-2.5 bg-foreground rounded-sm opacity-80" />
                            <div className="w-0.5 h-2.5 bg-foreground rounded-sm opacity-30" />
                        </div>
                    </div>

                    {/* Email App Header */}
                    <div className="px-4 py-2 border-b bg-background z-10 sticky top-8">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                {sampleLead.name[0]}
                            </div>
                            <div>
                                <div className="text-sm font-bold truncate w-48">{sampleLead.name}</div>
                                <div className="text-[10px] text-muted-foreground">To: me</div>
                            </div>
                            <div className="ml-auto text-[10px] text-muted-foreground">Now</div>
                        </div>
                        <div className="text-sm font-bold leading-tight line-clamp-2">{filledSubject}</div>
                    </div>

                    {/* Content */}
                    <ScrollArea className="h-[calc(100%-140px)] px-4 py-4 bg-background">
                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 font-sans">
                            {filledBody}
                            <br /><br />
                            <div className="text-muted-foreground text-xs mt-4 pt-4 border-t">
                                <p>[Your Signature]</p>
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Bottom Bar */}
                    <div className="absolute bottom-0 w-full h-12 bg-muted/10 backdrop-blur-md border-t flex items-center justify-around px-6">
                        <Mail className="w-5 h-5 text-primary" />
                        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />
                        <div className="w-5 h-5 rounded-sm border-2 border-muted-foreground/30" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl max-h-[95vh] h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
                <div className="p-6 border-b shrink-0 flex items-center justify-between bg-card/50 backdrop-blur-sm">
                    <div>
                        <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                            <Mail className="h-5 w-5 text-primary" />
                            Launch Outreach
                        </DialogTitle>
                        <DialogDescription className="mt-1 flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs font-mono">
                                <Users className="h-3 w-3 mr-1" />
                                {leads.length} leads
                            </Badge>
                            <span className="text-xs text-muted-foreground">• Config saved automatically</span>
                        </DialogDescription>
                    </div>
                    <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg">
                        <Button
                            variant={viewMode === "edit" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("edit")}
                            className="h-8 text-xs"
                        >
                            Configure
                        </Button>
                        <Button
                            variant={viewMode === "preview" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("preview")}
                            className="h-8 text-xs"
                        >
                            <Smartphone className="h-3 w-3 mr-1" />
                            Mobile Preview
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2">
                    {/* Configuration Column */}
                    <div className={`flex-col h-full overflow-hidden ${viewMode === 'preview' ? 'hidden lg:flex' : 'flex'}`}>
                        <ScrollArea className="flex-1 p-6">
                            <div className="space-y-8 pb-10">
                                {/* Settings Card */}
                                <div className="space-y-4">
                                    <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Campaign Details</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold">Campaign Name</Label>
                                            <Input 
                                                value={campaignName} 
                                                onChange={e => setCampaignName(e.target.value)} 
                                                placeholder="e.g. Q1 Sales Push"
                                                className="h-10 text-sm bg-muted/30 border-0 focus-visible:ring-0 rounded-xl"
                                            />
                                        </div>
                                    </div>

                                    <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground pt-4">Campaign Logic</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-4 bg-muted/30 rounded-2xl border border-border/50 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-bold">Daily Volume</Label>
                                                <Badge variant="outline" className="text-[10px] font-mono">{dailyLimit}/day</Badge>
                                            </div>
                                            <Slider
                                                value={[dailyLimit]}
                                                onValueChange={v => setDailyLimit(v[0])}
                                                min={10} max={500} step={5}
                                                className="py-2"
                                            />
                                        </div>

                                        <div className="p-4 bg-muted/30 rounded-2xl border border-border/50 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-bold">Follow-up Delay</Label>
                                                <Select value={followUpDays} onValueChange={setFollowUpDays}>
                                                    <SelectTrigger className="w-24 h-7 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {[2, 3, 5, 7, 10, 14].map(d => (
                                                            <SelectItem key={d} value={d.toString()}>{d} days</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground">Wait time if no reply</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Templates */}
                                <Tabs defaultValue="initial" className="w-full">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Message Sequence</h3>
                                        <TabsList className="h-8">
                                            <TabsTrigger value="initial" className="text-xs h-6 px-3">Step 1: Initial</TabsTrigger>
                                            <TabsTrigger value="followup" className="text-xs h-6 px-3">Step 2: FU 1</TabsTrigger>
                                            <TabsTrigger value="followup2" className="text-xs h-6 px-3">Step 3: FU 2</TabsTrigger>
                                            <TabsTrigger value="autoreply" className="text-xs h-6 px-3">Reply</TabsTrigger>
                                        </TabsList>
                                    </div>

                                    <TabsContent value="initial" className="space-y-4 animate-in fade-in slide-in-from-left-2 duration-300">
                                        <div className="flex justify-end">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleAIDraft}
                                                disabled={isGeneratingAI}
                                                className="h-7 text-[10px]"
                                            >
                                                {isGeneratingAI ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                                                Generate Copy
                                            </Button>
                                        </div>
                                        <div className="space-y-3">
                                            <Input
                                                value={subject}
                                                onChange={e => setSubject(e.target.value)}
                                                placeholder="Subject line..."
                                                className="font-bold border-0 bg-muted/30 focus-visible:ring-0 px-4 py-6 text-lg rounded-xl"
                                            />
                                            <Textarea
                                                value={body}
                                                onChange={e => setBody(e.target.value)}
                                                className="min-h-[300px] bg-muted/10 border-0 focus-visible:ring-0 text-sm leading-relaxed p-4 resize-none rounded-xl font-mono"
                                                placeholder="Write your message here..."
                                            />
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="followup" className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
                                        <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl text-xs font-bold mb-4 flex gap-2">
                                            <Clock className="w-4 h-4" />
                                            Sends automatically {followUpDays} days after Step 1 if no reply.
                                        </div>
                                        <div className="space-y-3">
                                            <Input
                                                value={followUpSubject}
                                                onChange={e => setFollowUpSubject(e.target.value)}
                                                placeholder="Follow-up subject..."
                                                className="font-bold border-0 bg-muted/30 focus-visible:ring-0 px-4 py-6 text-lg rounded-xl"
                                            />
                                            <Textarea
                                                value={followUpBody}
                                                onChange={e => setFollowUpBody(e.target.value)}
                                                className="min-h-[300px] bg-muted/10 border-0 focus-visible:ring-0 text-sm leading-relaxed p-4 resize-none rounded-xl font-mono"
                                                placeholder="Write your follow-up message..."
                                            />
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="followup2" className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
                                        <div className="p-3 bg-purple-500/10 text-purple-500 rounded-xl text-xs font-bold mb-4 flex gap-2">
                                            <Clock className="w-4 h-4" />
                                            Sends automatically {parseInt(followUpDays) + 4} days after Step 1 if no reply.
                                        </div>
                                        <div className="space-y-3">
                                            <Input
                                                value={followUpSubject2}
                                                onChange={e => setFollowUpSubject2(e.target.value)}
                                                placeholder="Final follow-up subject..."
                                                className="font-bold border-0 bg-muted/30 focus-visible:ring-0 px-4 py-6 text-lg rounded-xl"
                                            />
                                            <Textarea
                                                value={followUpBody2}
                                                onChange={e => setFollowUpBody2(e.target.value)}
                                                className="min-h-[300px] bg-muted/10 border-0 focus-visible:ring-0 text-sm leading-relaxed p-4 resize-none rounded-xl font-mono"
                                                placeholder="Write your final follow-up message..."
                                            />
                                        </div>
                                    </TabsContent>
                                    <TabsContent value="autoreply" className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
                                        <div className="p-3 bg-green-500/10 text-green-500 rounded-xl text-xs font-bold mb-4 flex gap-2">
                                            <Wand2 className="w-4 h-4" />
                                            Sends automatically 2-3 minutes after lead replies to any step.
                                        </div>
                                        <div className="space-y-3">
                                            <div className="px-4 py-2 bg-muted/30 rounded-xl text-xs text-muted-foreground font-bold">
                                                Subject: Re: [Original Subject]
                                            </div>
                                            <Textarea
                                                value={autoReplyBody}
                                                onChange={e => setAutoReplyBody(e.target.value)}
                                                className="min-h-[300px] bg-muted/10 border-0 focus-visible:ring-0 text-sm leading-relaxed p-4 resize-none rounded-xl font-mono"
                                                placeholder="Write your automated reply..."
                                            />
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Preview Column */}
                    <div className={`bg-muted/10 border-l border-border/50 h-full flex-col ${viewMode === 'preview' ? 'flex' : 'hidden lg:flex'}`}>
                        <div className="p-4 border-b flex justify-center gap-4">
                            <Button
                                variant={previewDevice === 'ios' ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setPreviewDevice('ios')}
                                className="h-7 text-xs rounded-full px-4"
                            >
                                iOS
                            </Button>
                            <Button
                                variant={previewDevice === 'android' ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setPreviewDevice('android')}
                                className="h-7 text-xs rounded-full px-4"
                            >
                                Android
                            </Button>
                        </div>
                        <div className="flex-1 relative overflow-hidden p-4">
                            <Tabs defaultValue="preview-initial" className="w-full h-full">
                                <TabsList className="absolute top-4 right-4 z-30 bg-background/80 backdrop-blur shadow-sm h-8">
                                    <TabsTrigger value="preview-initial" className="text-[10px] h-6">S1</TabsTrigger>
                                    <TabsTrigger value="preview-followup" className="text-[10px] h-6">S2</TabsTrigger>
                                    <TabsTrigger value="preview-followup2" className="text-[10px] h-6">S3</TabsTrigger>
                                    <TabsTrigger value="preview-autoreply" className="text-[10px] h-6">Reply</TabsTrigger>
                                </TabsList>
                                <TabsContent value="preview-initial" className="h-full m-0">
                                    {renderPreview(subject, body)}
                                </TabsContent>
                                <TabsContent value="preview-followup" className="h-full m-0">
                                    {renderPreview(followUpSubject, followUpBody)}
                                </TabsContent>
                                <TabsContent value="preview-followup2" className="h-full m-0">
                                    {renderPreview(followUpSubject2, followUpBody2)}
                                </TabsContent>
                                <TabsContent value="preview-autoreply" className="h-full m-0">
                                    {renderPreview(`Re: ${subject}`, autoReplyBody)}
                                </TabsContent>
                            </Tabs>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-card/50 backdrop-blur-sm flex justify-between items-center shrink-0">
                    <p className="text-[10px] text-muted-foreground hidden sm:block">
                        Campaign messages are sent as raw text for maximum deliverability.
                    </p>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button variant="ghost" onClick={onClose} className="flex-1 sm:flex-none">
                            Cancel
                        </Button>
                        <Button
                            onClick={() => handleLaunch()}
                            disabled={isLoading || !subject.trim() || !body.trim()}
                            className="flex-1 sm:flex-none gap-2 shadow-lg shadow-primary/20"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Launching...
                                </>
                            ) : (
                                <>
                                    <Send className="h-4 w-4" />
                                    Launch Campaign
                                </>
                            )}
                        </Button>
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
