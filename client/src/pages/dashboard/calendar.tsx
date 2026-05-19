import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  CalendarDays,
  Plus,
  Settings,
  Link as LinkIcon,
  Bot,
  Target,
  Timer,
  Activity,
  Zap,
  Brain,
  Sparkles,
  MoreHorizontal,
  Globe
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PremiumLoader } from "@/components/ui/premium-loader";

interface CalendarSettings {
  id: string;
  calendlyEnabled: boolean;
  calendlyUsername: string | null;
  googleCalendarEnabled: boolean;
  autoBookingEnabled: boolean;
  minIntentScore: number;
  minTimingScore: number;
  meetingDuration: number;
  titleTemplate: string;
  bufferBefore: number;
  bufferAfter: number;
  workingHoursStart: number;
  workingHoursEnd: number;
  timezone: string;
  bookingPreference: 'link' | 'autonomous';
}

interface CalendarBooking {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingUrl: string | null;
  attendeeEmail: string | null;
  attendeeName: string | null;
  status: string;
  isAiBooked: boolean;
  intentScoreAtBooking: number | null;
  provider: string;
}

interface AIActionLog {
  id: string;
  actionType: string;
  decision: string;
  intentScore: number | null;
  timingScore: number | null;
  confidence: number | null;
  reasoning: string | null;
  createdAt: string;
}

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [calendlyToken, setCalendlyToken] = useState("");
  const [newEvent, setNewEvent] = useState({
    summary: "",
    description: "",
    startTime: "",
    endTime: "",
    attendeeEmail: "",
  });

  const { data: settingsData, isLoading: settingsLoading } = useQuery<{ settings: CalendarSettings }>({
    queryKey: ["/api/calendar/settings"],
    retry: false,
  });

  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<{ bookings: CalendarBooking[] }>({
    queryKey: ["/api/calendar/bookings"],
    retry: false,
  });

  const { data: aiLogsData } = useQuery<{ logs: AIActionLog[] }>({
    queryKey: ["/api/calendar/ai-logs"],
    retry: false,
  });

  const { data: eventsData } = useQuery({
    queryKey: ["/api/oauth/google-calendar/events"],
    retry: false,
  });

  const settings = settingsData?.settings;
  const bookings = bookingsData?.bookings || [];
  const aiLogs = aiLogsData?.logs || [];
  const googleEvents = (eventsData as any)?.events || [];

  const allEvents = [
    ...bookings.map(b => ({
      id: b.id,
      title: b.title,
      startTime: b.startTime,
      endTime: b.endTime,
      meetingUrl: b.meetingUrl,
      isAiBooked: b.isAiBooked,
      leadName: b.attendeeName,
      provider: b.provider,
      status: b.status,
      intentScore: b.intentScoreAtBooking,
    })),
    ...googleEvents.map((e: any) => ({
      id: e.id,
      title: e.title || e.summary,
      startTime: e.startTime || e.start?.dateTime,
      endTime: e.endTime || e.end?.dateTime,
      meetingUrl: e.meetingUrl || e.hangoutLink,
      isAiBooked: e.isAiBooked || false,
      leadName: e.leadName,
      provider: 'google',
      status: 'scheduled',
    })),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const aiScheduledCount = allEvents.filter(e => e.isAiBooked).length;

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<CalendarSettings>) => {
      const response = await apiRequest("PATCH", "/api/calendar/settings", updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/settings"] });
      toast({ title: "Settings updated" });
    },
    onError: () => {
      toast({ title: "Failed to update settings", variant: "destructive" });
    },
  });

  const connectCalendlyMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await apiRequest("POST", "/api/calendar/connect-calendly", { token });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/settings"] });
      setCalendlyToken("");
      toast({ title: "Calendly connected", description: `Connected as ${data.username}` });
    },
    onError: (error: any) => {
      toast({ title: "Failed to connect", description: error.message, variant: "destructive" });
    },
  });

  const disconnectCalendlyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/calendar/disconnect-calendly", {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/settings"] });
      toast({ title: "Calendly disconnected" });
    },
  });

  const createEventMutation = useMutation({
    mutationFn: async (eventData: typeof newEvent) => {
      const response = await fetch("/api/oauth/google-calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(eventData),
      });
      if (!response.ok) throw new Error("Failed to create event");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/oauth/google-calendar/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bookings"] });
      setShowCreateDialog(false);
      setNewEvent({ summary: "", description: "", startTime: "", endTime: "", attendeeEmail: "" });
      toast({ title: "Event created" });
    },
    onError: () => {
      toast({ title: "Failed to create event", variant: "destructive" });
    },
  });

  const isLoading = settingsLoading || bookingsLoading;

  if (isLoading) {
    return <PremiumLoader text="Syncing Calendar..." />;
  }

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white inline-flex items-center gap-3">
            Calendar Sync <Activity className="h-8 w-8 text-primary" />
          </h1>
          <p className="text-white/40 font-semibold mt-1 uppercase tracking-wider text-xs">Professional Schedule Management</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setShowSettingsSheet(true)}
            className="rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold h-11 px-6"
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="rounded-xl bg-primary text-primary-foreground font-bold uppercase tracking-wider text-[10px] h-11 px-6 shadow-md shadow-primary/15"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Event
          </Button>
        </div>
      </div>
      <Sheet open={showSettingsSheet} onOpenChange={setShowSettingsSheet}>
        <SheetTrigger asChild>
          <Button variant="outline" className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10 transition-all font-semibold text-[10px] uppercase tracking-wider h-11 px-6">
            <Settings className="h-4 w-4 mr-2" />
            Calendar Settings
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto border-l-primary/10 bg-background/95 backdrop-blur-xl">
          <SheetHeader>
            <SheetTitle className="text-2xl font-bold">Calendar Settings</SheetTitle>
            <SheetDescription>
              Configure calendar connections and AI booking behavior
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2 text-primary">
                <LinkIcon className="h-4 w-4" /> Connections
              </h3>
              <Card className="border-border/40 bg-card/50 rounded-xl">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <CalendarIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Calendly</p>
                      <p className="text-sm text-muted-foreground">{settings?.calendlyEnabled ? "Connected" : "Disconnected"}</p>
                    </div>
                  </div>
                  {settings?.calendlyEnabled ?
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg" onClick={() => disconnectCalendlyMutation.mutate()}>Disconnect</Button> :
                    <div className="flex gap-2">
                      <Input placeholder="Token" value={calendlyToken} onChange={(e) => setCalendlyToken(e.target.value)} className="w-32 h-8 text-xs rounded-lg" />
                      <Button size="sm" className="rounded-lg" onClick={() => connectCalendlyMutation.mutate(calendlyToken)}>Connect</Button>
                    </div>
                  }
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition-colors group">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-purple-400 group-hover:animate-pulse" />
                    <Label className="text-base font-medium">Automated Time Suggestions</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    AI will suggest specific meeting times based on real-time availability.
                  </p>
                </div>
                <Switch
                  checked={settings?.bookingPreference === 'autonomous'}
                  onCheckedChange={(checked) => updateSettingsMutation.mutate({
                    bookingPreference: checked ? 'autonomous' : 'link'
                  })}
                  className="data-[state=checked]:bg-purple-500"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition-colors group">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-blue-400 group-hover:animate-bounce" />
                    <Label className="text-base font-medium">Smart Availability Guard</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Automatically block times for high-priority leads.
                  </p>
                </div>
                <Switch
                  checked={settings?.autoBookingEnabled}
                  onCheckedChange={(checked) =>
                    updateSettingsMutation.mutate({ autoBookingEnabled: checked })
                  }
                  className="data-[state=checked]:bg-blue-500"
                />
              </div>
            </div>
            <Separator className="bg-border/40" />
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2 text-primary">
                <Brain className="h-4 w-4" /> AI Scheduling
              </h3>
              <div className="flex items-center justify-between p-4 rounded-lg bg-primary/5 border border-primary/10">
                <div>
                  <p className="font-medium">Automated Scheduling</p>
                  <p className="text-xs text-muted-foreground">Allow AI to automatically schedule meetings</p>
                </div>
                <Switch checked={settings?.autoBookingEnabled ?? false} onCheckedChange={(c) => updateSettingsMutation.mutate({ autoBookingEnabled: c })} />
              </div>

              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label>Minimum Intent Score</Label>
                    <span className="text-primary font-bold">{settings?.minIntentScore}%</span>
                  </div>
                  <Slider
                    value={[settings?.minIntentScore || 85]}
                    max={100}
                    step={5}
                    onValueChange={([v]) => updateSettingsMutation.mutate({ minIntentScore: v })}
                  />
                  <p className="text-[10px] text-muted-foreground">Only schedule meetings for leads with this minimum intent score.</p>
                </div>

                <div className="space-y-2">
                  <Label>Default Meeting Duration</Label>
                  <Select
                    value={String(settings?.meetingDuration || 30)}
                    onValueChange={(v) => updateSettingsMutation.mutate({ meetingDuration: Number(v) })}
                  >
                    <SelectTrigger className="bg-black/40 border-white/10 rounded-lg">
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 Minutes (Rapid)</SelectItem>
                      <SelectItem value="30">30 Minutes (Standard)</SelectItem>
                      <SelectItem value="45">45 Minutes (Strategy)</SelectItem>
                      <SelectItem value="60">60 Minutes (Deep Dive)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator className="bg-border/40" />
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2 text-primary">
                <Timer className="h-4 w-4" /> Buffer Settings
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Buffer Before</Label>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={settings?.bufferBefore || 5}
                    onChange={(e) => updateSettingsMutation.mutate({ bufferBefore: Number(e.target.value) })}
                    className="bg-black/40 border-white/10 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Buffer After</Label>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={settings?.bufferAfter || 5}
                    onChange={(e) => updateSettingsMutation.mutate({ bufferAfter: Number(e.target.value) })}
                    className="bg-black/40 border-white/10 rounded-lg"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Add buffer time before and after meetings.</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Integration Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Calendly Card */}
        <Card className="bg-[#050505] border-white/5 rounded-2xl p-6 group hover:border-primary/20 transition-all overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity">
            <CalendarIcon className="w-24 h-24" />
          </div>
          <div className="flex items-start justify-between mb-6">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${settings?.calendlyEnabled ? 'bg-primary/20 border-primary/40' : 'bg-white/5 border-white/10'}`}>
              <LinkIcon className={`w-6 h-6 ${settings?.calendlyEnabled ? 'text-primary' : 'text-white/20'}`} />
            </div>
            <Badge className={`${settings?.calendlyEnabled ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30' : 'bg-white/5 text-white/30 border-white/10'} font-semibold text-[9px] uppercase tracking-wider`}>
              {settings?.calendlyEnabled ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Calendly</h3>
          <p className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Meeting link connection</p>
        </Card>

        {/* Google Calendar Card */}
        <Card className="bg-[#050505] border-white/5 rounded-2xl p-6 group hover:border-indigo-500/20 transition-all overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity">
            <Globe className="w-24 h-24" />
          </div>
          <div className="flex items-start justify-between mb-6">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${settings?.googleCalendarEnabled ? 'bg-indigo-500/20 border-indigo-500/40' : 'bg-white/5 border-white/10'}`}>
              <CalendarDays className={`w-6 h-6 ${settings?.googleCalendarEnabled ? 'text-indigo-400' : 'text-white/20'}`} />
            </div>
            <Badge className={`${settings?.googleCalendarEnabled ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30' : 'bg-white/5 text-white/30 border-white/10'} font-semibold text-[9px] uppercase tracking-wider`}>
              {settings?.googleCalendarEnabled ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Google Calendar</h3>
          <p className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Standard calendar sync</p>
        </Card>

        {/* AI Scheduled Stat */}
        <Card className="bg-primary/5 border-primary/10 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-50" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 text-primary mb-4">
              <Brain className="w-5 h-5 animate-pulse" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">AI Performance</span>
            </div>
            <div className="text-3xl font-bold text-white tracking-tight mb-1">{aiScheduledCount}</div>
            <p className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Automated appointments</p>
          </div>
        </Card>

        {/* Intelligence Mode */}
        <Card className="bg-[#0d0d0d] border-white/5 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 text-amber-500 mb-4">
              <Zap className="w-5 h-5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Booking Status</span>
            </div>
            <div className="text-xl font-bold text-white tracking-tight uppercase">{settings?.autoBookingEnabled ? "Status: Automated" : "View Only"}</div>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full mt-4 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: settings?.autoBookingEnabled ? '100%' : '15%' }}
              className={`h-full ${settings?.autoBookingEnabled ? 'bg-primary shadow-[0_0_15px_#00d2ff]' : 'bg-white/20'}`}
            />
          </div>
        </Card>
      </div>

      {/* Main Content */}
      <div className="space-y-6">
        {settings?.autoBookingEnabled && aiLogs.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-transparent to-transparent rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" /> AI Activity Stream
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {aiLogs.slice(0, 3).map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 rounded-xl bg-background/50 border border-border/50">
                    <div className="flex items-center gap-3">
                      <Badge variant={log.decision === 'act' ? 'default' : 'secondary'} className="rounded-lg">{log.decision}</Badge>
                      <span className="text-sm text-muted-foreground">{log.reasoning}</span>
                    </div>
                    <span className="text-xs text-muted-foreground opacity-50">{new Date(log.createdAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        <div className="min-h-[400px]">
          {allEvents.length === 0 ? (
            <div className="py-20 text-center space-y-6 bg-[#050505] rounded-2xl border border-white/5 border-dashed">
              <div className="w-20 h-20 bg-primary/5 rounded-2xl mx-auto flex items-center justify-center border border-primary/10">
                <CalendarDays className="h-10 w-10 text-primary/40" />
              </div>
              <div className="max-w-xs mx-auto space-y-2">
                <h3 className="text-sm font-bold text-white">No events scheduled</h3>
                <p className="text-[10px] uppercase font-semibold text-white/20 tracking-wider">Your calendar is currently clear. Scheduled events will appear here.</p>
              </div>
              {!settings?.calendlyEnabled && (
                <Button
                  onClick={() => setShowSettingsSheet(true)}
                  className="rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold h-10 px-6 transition-all"
                >
                  Connect Calendar
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {allEvents.map((event, index) => (
                <motion.div key={event.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }}>
                  <Card className="hover:border-primary/30 transition-colors group rounded-2xl">
                    <CardContent className="p-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-xl ${event.isAiBooked ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                          <span className="text-xs font-medium uppercase truncate w-full text-center px-1">{new Date(event.startTime).toLocaleString('default', { month: 'short' })}</span>
                          <span className="text-2xl font-bold">{new Date(event.startTime).getDate()}</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg flex items-center gap-2">
                            {event.title}
                            {event.isAiBooked && <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 text-[10px] h-5 rounded-md">AI Booked</Badge>}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(event.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {event.leadName && <span className="flex items-center gap-1"><Target className="h-3 w-3" /> {event.leadName}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        {event.meetingUrl && (
                          <Button size="sm" variant="outline" className="gap-2 rounded-lg" asChild>
                            <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
                              <Video className="h-4 w-4" /> Join
                            </a>
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="rounded-lg">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="rounded-2xl border-border/30 bg-background/95 backdrop-blur-xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Schedule Event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <Input placeholder="Event Title" className="rounded-lg" value={newEvent.summary} onChange={(e) => setNewEvent({ ...newEvent, summary: e.target.value })} />
              <div className="grid grid-cols-2 gap-4">
                <Input type="datetime-local" className="rounded-lg" value={newEvent.startTime} onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })} />
                <Input type="datetime-local" className="rounded-lg" value={newEvent.endTime} onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })} />
              </div>
              <Input placeholder="Description" className="rounded-lg" value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} />
              <Input placeholder="Attendee Email" className="rounded-lg" value={newEvent.attendeeEmail} onChange={(e) => setNewEvent({ ...newEvent, attendeeEmail: e.target.value })} />
              <Button className="w-full rounded-xl h-11" onClick={() => createEventMutation.mutate(newEvent)}>Schedule</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
