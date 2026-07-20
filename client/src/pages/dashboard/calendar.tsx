import { useMailbox } from "@/hooks/use-mailbox";
import { MailboxSwitcher } from "@/components/outreach/MailboxSwitcher";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Globe,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  User,
  Mail,
  Building,
  Trash2,
  MoreHorizontal,
  X,
  Share2,
  Phone,
  Star,
  TrendingUp,
  ArrowRight,
  RotateCcw,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock3,
  CalendarClock,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { cn } from "@/lib/utils";

interface CalendarSettings {
  id: string;
  calendlyEnabled: boolean;
  calendlyUsername: string | null;
  calendarLink: string | null;
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
  leadId: string | null;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  meetingUrl: string | null;
  attendeeEmail: string | null;
  attendeeName: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  isAiBooked: boolean;
  intentScoreAtBooking: number | null;
  confidenceAtBooking: number | null;
  bookingReason: string | null;
  provider: string;
  createdAt: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingUrl: string | null;
  isAiBooked: boolean;
  leadName: string | null;
  provider: string;
  status: string;
  intentScore: number | null;
  attendeeEmail: string | null;
  leadId: string | null;
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

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  scheduled: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: <CalendarClock className="h-3 w-3" />, label: 'Scheduled' },
  completed: { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed' },
  cancelled: { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: <XCircle className="h-3 w-3" />, label: 'Cancelled' },
  no_show: { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: <AlertTriangle className="h-3 w-3" />, label: 'No Show' },
};

export default function CalendarPage() {
  const { toast } = useToast();
  const { socket, isConnected } = useRealtime();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/"] });
    };
    socket.on("settings_updated", handleUpdate);
    socket.on("calendar_updated", handleUpdate);
    return () => {
      socket.off("settings_updated", handleUpdate);
      socket.off("calendar_updated", handleUpdate);
    };
  }, [socket, queryClient]);
  const { selectedMailboxId, setSelectedMailboxId } = useMailbox();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [showEventDetail, setShowEventDetail] = useState<CalendarEvent | null>(null);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState<CalendarEvent | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [newEvent, setNewEvent] = useState({
    summary: "",
    description: "",
    startTime: "",
    endTime: "",
    attendeeEmail: "",
  });

  const pollingMs = isConnected ? false : 15000;

  const { data: settingsData, isLoading: settingsLoading } = useQuery<{ settings: CalendarSettings }>({
    queryKey: ["/api/calendar/settings"],
    retry: 3,
    refetchInterval: pollingMs,
  });

  const { data: bookingsData, isLoading: bookingsLoading } = useQuery<{ bookings: CalendarBooking[] }>({
    queryKey: ["/api/calendar/bookings"],
    retry: 3,
    refetchInterval: pollingMs,
  });

  const { data: aiLogsData } = useQuery<{ logs: AIActionLog[] }>({
    queryKey: ["/api/calendar/ai-logs"],
    retry: 3,
    refetchInterval: pollingMs,
  });

  const { data: eventsData } = useQuery<{ events: Array<{ id: string; title?: string; summary?: string; startTime?: string; start?: { dateTime?: string }; endTime?: string; end?: { dateTime?: string }; meetingUrl?: string; hangoutLink?: string; isAiBooked?: boolean; leadName?: string | null }> }>({
    queryKey: ["/api/oauth/google-calendar/events"],
    retry: 3,
    refetchInterval: pollingMs,
  });

  const { data: calendarEventsData } = useQuery<{ events: Array<{ id: string; title: string; startTime: string; endTime: string; meetingUrl: string | null; isAiBooked: boolean; leadName?: string | null; provider: string; status: string; attendeeEmail: string | null; leadId: string | null }> }>({
    queryKey: ["/api/calendar/events"],
    retry: 3,
    refetchInterval: pollingMs,
  });

  const { data: slotsData } = useQuery<{ slots: Array<{ start: string; end: string; available: boolean }> }>({
    queryKey: ["/api/calendar/slots", { daysAhead: 14 }],
    retry: 3,
    refetchInterval: pollingMs,
  });

  const settings = settingsData?.settings;
  const bookings = bookingsData?.bookings || [];
  const aiLogs = aiLogsData?.logs || [];
  const googleEvents = eventsData?.events || [];
  const syncedEvents = calendarEventsData?.events || [];
  const availableSlots = slotsData?.slots || [];

  const allEvents: CalendarEvent[] = useMemo(() => [
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
      attendeeEmail: b.attendeeEmail,
      leadId: b.leadId,
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
      intentScore: null,
      attendeeEmail: null,
      leadId: null,
    })),
    ...syncedEvents.map(e => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      meetingUrl: e.meetingUrl,
      isAiBooked: e.isAiBooked,
      leadName: e.leadName || e.attendeeEmail,
      provider: e.provider,
      status: e.status,
      intentScore: null,
      attendeeEmail: e.attendeeEmail,
      leadId: e.leadId,
    })),
  ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()), [bookings, googleEvents, syncedEvents]);

  const aiScheduledCount = allEvents.filter(e => e.isAiBooked).length;
  const totalBookings = allEvents.length;
  const upcomingBookings = allEvents.filter(e =>
    new Date(e.startTime) > new Date() && e.status === 'scheduled'
  ).length;

  const toLocalDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const eventsForDate = useCallback((date: Date) => {
    const dateStr = toLocalDateStr(date);
    return allEvents.filter(e => {
      const eventDate = toLocalDateStr(new Date(e.startTime));
      return eventDate === dateStr;
    });
  }, [allEvents]);

  const weekDays = useMemo(() => {
    const start = new Date(selectedDate);
    start.setDate(start.getDate() - start.getDay());
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [selectedDate]);

  const monthDays = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, isCurrentMonth: false });
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  }, [selectedDate]);

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    } else {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    }
    setSelectedDate(newDate);
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<CalendarSettings>) => {
      const response = await apiRequest("PATCH", "/api/calendar/settings", updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/settings"] });
      toast({ title: "Settings updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update settings", description: err?.message || "", variant: "destructive" });
    },
  });

  const disconnectCalendlyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/calendar/disconnect-calendly", {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({ title: "Calendly disconnected" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to disconnect", description: err?.message || "", variant: "destructive" });
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

  const connectGoogleMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/oauth/connect/google-calendar", { credentials: "include" });
      if (!response.ok) {
        const text = await response.text();
        let err;
        try { err = JSON.parse(text); } catch { err = { error: text }; }
        throw new Error(err.error || "Failed to start Google connection");
      }
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      return data;
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: err?.message || "", variant: "destructive" });
    },
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/oauth/google-calendar/disconnect", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/bookings"] });
      toast({ title: "Google Calendar disconnected" });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to disconnect";
      toast({ title: "Disconnect failed", description: msg, variant: "destructive" });
    },
  });

  const connectCalendlyOAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/oauth/connect/calendly", { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        let err;
        try { err = JSON.parse(text); } catch { err = { error: text }; }
        throw new Error(err.error || "Failed to start Calendly connection");
      }
      const data = await res.json();
      if (data.authUrl) {
        // Force a fresh redirect — avoids stale browser state after disconnect
        window.location.replace(data.authUrl);
      } else {
        throw new Error("No authorization URL returned");
      }
      return data;
    },
    onError: (err: any) => {
      toast({ title: "Connection failed", description: err?.message || "Try again", variant: "destructive" });
    },
  });

  const copyBookingLink = useCallback(() => {
    const link = settings?.calendarLink || '';
    if (!link) {
      toast({ title: "No booking link configured", description: "Set your Calendly or calendar link in Settings", variant: "destructive" });
      return;
    }
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    toast({ title: "Booking link copied" });
    setTimeout(() => setCopiedLink(false), 2000);
  }, [settings]);

  const isLoading = settingsLoading || bookingsLoading;
  if (isLoading) return <PremiumLoader text="Loading calendar..." />;

  return (
    <div className="p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white inline-flex items-center gap-3">
            Calendar <CalendarDays className="h-6 w-6 text-primary" />
          </h1>
          <p className="text-white/40 text-sm mt-1">Manage bookings and availability</p>
        </div>
        <div className="flex items-center gap-3">
          <MailboxSwitcher value={selectedMailboxId} onValueChange={setSelectedMailboxId} />
          <Button
            onClick={copyBookingLink}
            variant="outline"
            className="rounded-xl bg-white/5 border-white/10 hover:bg-white/10 text-white h-10 px-4"
          >
            {copiedLink ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <Copy className="mr-2 h-4 w-4" />}
            {copiedLink ? "Copied" : "Copy Booking Link"}
          </Button>
          <Button
            onClick={() => setShowSettingsSheet(true)}
            variant="outline"
            className="rounded-xl bg-white/5 border-white/10 hover:bg-white/10 text-white h-10 px-4"
          >
            <Settings className="mr-2 h-4 w-4" /> Settings
          </Button>
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="rounded-xl bg-primary text-primary-foreground font-bold h-10 px-4"
          >
            <Plus className="mr-2 h-4 w-4" /> New Event
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#050505] border-white/5 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <CalendarIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{totalBookings}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">Total Bookings</p>
            </div>
          </div>
        </Card>
        <Card className="bg-[#050505] border-white/5 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Clock3 className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{upcomingBookings}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">Upcoming</p>
            </div>
          </div>
        </Card>
        <Card className="bg-[#050505] border-white/5 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{aiScheduledCount}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">AI Booked</p>
            </div>
          </div>
        </Card>
        <Card className="bg-[#050505] border-white/5 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${settings?.calendlyEnabled ? 'bg-emerald-500/10' : 'bg-white/5'}`}>
              <LinkIcon className={`h-5 w-5 ${settings?.calendlyEnabled ? 'text-emerald-400' : 'text-white/20'}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">{settings?.calendlyEnabled ? 'Connected' : 'Disconnected'}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">Calendly</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Main Content: Calendar + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-[#050505] border-white/5 rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between p-4 pb-0">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => navigateDate('prev')} className="h-8 w-8">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h2 className="text-lg font-bold text-white min-w-[200px] text-center">
                  {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                <Button variant="ghost" size="icon" onClick={() => navigateDate('next')} className="h-8 w-8">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDate(new Date())}
                  className="text-xs text-white/60 hover:text-white"
                >
                  Today
                </Button>
                <div className="flex bg-white/5 rounded-lg p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('month')}
                    className={cn("text-xs h-7 px-3 rounded-md", viewMode === 'month' ? 'bg-white/10 text-white' : 'text-white/40')}
                  >
                    Month
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('week')}
                    className={cn("text-xs h-7 px-3 rounded-md", viewMode === 'week' ? 'bg-white/10 text-white' : 'text-white/40')}
                  >
                    Week
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {viewMode === 'month' ? (
                <div className="grid grid-cols-7 gap-px">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="text-center text-[10px] text-white/30 uppercase tracking-wider font-semibold py-2">
                      {day}
                    </div>
                  ))}
                    {monthDays.map(({ date, isCurrentMonth }, idx) => {
                    const dayEvents = eventsForDate(date);
                    const isToday = date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
                    const isSelected = date.toISOString().split('T')[0] === selectedDate.toISOString().split('T')[0];
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedDate(date)}
                        className={cn(
                          "relative h-20 md:h-24 p-1 text-left transition-colors border border-transparent",
                          isCurrentMonth ? 'hover:bg-white/5' : 'opacity-30',
                          isSelected && 'bg-white/5 border-white/10',
                          isToday && 'ring-1 ring-primary/30'
                        )}
                      >
                        <div className="flex justify-center mb-0.5">
                          <span className={cn(
                            "inline-flex items-center justify-center w-8 h-8 text-xs font-semibold transition-all",
                            isSelected && !isToday ? 'bg-white/10 text-white rounded-full' : 'rounded-full',
                            isToday ? 'bg-primary text-primary-foreground rounded-full shadow-lg shadow-primary/30' : '',
                            isSelected && isToday ? 'ring-2 ring-white/50' : '',
                            !isToday && !isSelected ? 'text-white/60' : ''
                          )}>
                            {date.getDate()}
                          </span>
                        </div>
                        <div className="space-y-0.5 mt-1">
                          {dayEvents.slice(0, 3).map(event => (
                            <div
                              key={event.id}
                              onClick={(e) => { e.stopPropagation(); setShowEventDetail(event); }}
                              className={cn(
                                "text-[9px] md:text-[10px] truncate px-1.5 py-0.5 rounded cursor-pointer transition-colors",
                                event.isAiBooked
                                  ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'
                                  : 'bg-primary/10 text-primary hover:bg-primary/20'
                              )}
                            >
                              {event.title}
                            </div>
                          ))}
                          {dayEvents.length > 3 && (
                            <div className="text-[9px] text-white/30 px-1.5">+{dayEvents.length - 3} more</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-px">
                  <div className="grid grid-cols-8 gap-px mb-2">
                    <div />
                    {weekDays.map((day, i) => {
                      const isToday = day.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
                      return (
                        <div key={i} className="text-center">
                          <div className="text-[10px] text-white/30 uppercase">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                          <div className={cn(
                            "text-sm font-bold w-8 h-8 rounded-full inline-flex items-center justify-center",
                            isToday ? 'bg-primary text-primary-foreground' : 'text-white/60'
                          )}>
                            {day.getDate()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {Array.from({ length: 12 }, (_, i) => i + 8).map(hour => (
                    <div key={hour} className="grid grid-cols-8 gap-px">
                      <div className="text-[10px] text-white/30 text-right pr-2 pt-1">{hour}:00</div>
                      {weekDays.map((day, di) => {
                        const hourEvents = eventsForDate(day).filter(e => {
                          const h = new Date(e.startTime).getHours();
                          return h === hour;
                        });
                        return (
                          <div
                            key={di}
                            className="h-10 border border-white/5 rounded-sm hover:bg-white/5 transition-colors cursor-pointer"
                            onClick={() => {
                              if (hourEvents.length > 0) setShowEventDetail(hourEvents[0]);
                              else {
                                setSelectedDate(day);
                                setNewEvent({ ...newEvent, startTime: `${day.toISOString().split('T')[0]}T${String(hour).padStart(2, '0')}:00`, endTime: `${day.toISOString().split('T')[0]}T${String(hour + 1).padStart(2, '0')}:00` });
                                setShowCreateDialog(true);
                              }
                            }}
                          >
                            {hourEvents.map(e => (
                              <div
                                key={e.id}
                                onClick={(ev) => { ev.stopPropagation(); setShowEventDetail(e); }}
                                className={cn(
                                  "text-[9px] truncate px-1 py-0.5 rounded-sm cursor-pointer",
                                  e.isAiBooked ? 'bg-purple-500/20 text-purple-300' : 'bg-primary/10 text-primary'
                                )}
                              >
                                {e.title}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected Date Events */}
          <Card className="bg-[#050505] border-white/5 rounded-2xl">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" /> {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-white/40 h-7" onClick={() => setSelectedDate(new Date())}>Today</Button>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {eventsForDate(selectedDate).length > 0 ? (
                <div className="space-y-2">
                  {eventsForDate(selectedDate)
                    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                    .map(event => (
                      <div
                        key={event.id}
                        onClick={() => setShowEventDetail(event)}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/5 border border-white/5 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={cn(
                            "flex flex-col items-center justify-center w-12 h-12 rounded-lg shrink-0",
                            event.isAiBooked ? 'bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20' : 'bg-white/5 border border-white/10'
                          )}>
                            <span className="text-[9px] font-medium text-white/40 uppercase">{new Date(event.startTime).toLocaleDateString('en-US', { month: 'short' })}</span>
                            <span className="text-lg font-bold text-white">{new Date(event.startTime).getDate()}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{event.title}</p>
                            <p className="text-xs text-white/40 truncate">
                              {new Date(event.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              {' - '}
                              {new Date(event.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              {event.leadName && ` · ${event.leadName}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {event.isAiBooked && (
                            <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[9px]">
                              <Bot className="h-2.5 w-2.5 mr-1" /> AI
                            </Badge>
                          )}
                          {event.meetingUrl && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                              <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                <Video className="h-3.5 w-3.5 text-white/40" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CalendarIcon className="h-8 w-8 text-white/10 mx-auto mb-2" />
                  <p className="text-sm text-white/20">No events on this day</p>
                  <Button variant="outline" size="sm" className="mt-3 text-xs border-white/10 bg-white/5" onClick={() => { setShowCreateDialog(true); }}>
                    <Plus className="h-3 w-3 mr-1" /> Create Event
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Events List */}
          <Card className="bg-[#050505] border-white/5 rounded-2xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {allEvents
                  .filter(e => new Date(e.startTime) > new Date() && e.status === 'scheduled')
                  .slice(0, 5)
                  .map(event => (
                    <div
                      key={event.id}
                      onClick={() => setShowEventDetail(event)}
                      className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/5 border border-white/5 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex flex-col items-center justify-center w-12 h-12 rounded-lg",
                          event.isAiBooked ? 'bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20' : 'bg-white/5 border border-white/10'
                        )}>
                          <span className="text-[9px] font-medium text-white/40 uppercase">{new Date(event.startTime).toLocaleDateString('en-US', { month: 'short' })}</span>
                          <span className="text-lg font-bold text-white">{new Date(event.startTime).getDate()}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{event.title}</p>
                          <p className="text-xs text-white/40">
                            {new Date(event.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            {event.leadName && ` · ${event.leadName}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {event.isAiBooked && (
                          <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[9px]">
                            <Bot className="h-2.5 w-2.5 mr-1" /> AI
                          </Badge>
                        )}
                        {event.meetingUrl && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                            <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                              <Video className="h-3.5 w-3.5 text-white/40" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                {allEvents.filter(e => new Date(e.startTime) > new Date() && e.status === 'scheduled').length === 0 && (
                  <div className="text-center py-8 text-white/20 text-sm">No upcoming bookings</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Integration Cards */}
          <div className="grid grid-cols-1 gap-3">
            <Card className="bg-[#050505] border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <CalendarIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Calendly</p>
                    <p className="text-[10px] text-white/40">{settings?.calendlyEnabled ? settings.calendlyUsername || 'Connected' : 'Not connected'}</p>
                  </div>
                </div>
                {settings?.calendlyEnabled ? (
                  <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs" onClick={() => disconnectCalendlyMutation.mutate()}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-xs border-white/10 bg-white/5" onClick={() => connectCalendlyOAuthMutation.mutate()}>
                    Connect
                  </Button>
                )}
              </div>
            </Card>
            <Card className="bg-[#050505] border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                    <Globe className="h-4 w-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Google Calendar</p>
                    <p className="text-[10px] text-emerald-400">{settings?.googleCalendarEnabled ? 'Connected' : 'Not connected'}</p>
                  </div>
                </div>
                {settings?.googleCalendarEnabled ? (
                  <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs" onClick={() => disconnectGoogleMutation.mutate()}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-xs border-white/10 bg-white/5" onClick={() => connectGoogleMutation.mutate()}>
                    Connect
                  </Button>
                )}
              </div>
            </Card>
          </div>

          {/* AI Activity */}
          {settings?.autoBookingEnabled && aiLogs.length > 0 && (
            <Card className="bg-card/50 border-border/40 rounded-xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> AI Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ScrollArea className="h-[200px]">
                  <div className="space-y-1.5">
                    {aiLogs.slice(0, 5).map(log => (
                      <div key={log.id} className="p-2.5 rounded-lg bg-muted/20 border border-border/30">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={log.decision === 'act' ? 'default' : 'secondary'} className="text-[9px] h-4 font-bold">
                            {log.decision === 'act' ? 'Acted' : 'Skipped'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{log.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Available Slots */}
          {availableSlots.length > 0 && (
            <Card className="bg-[#050505] border-white/5 rounded-xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="h-4 w-4 text-emerald-400" /> Available Slots
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-1.5">
                  {availableSlots.slice(0, 6).map((slot, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5 text-xs">
                      <span className="text-white/60">{new Date(slot.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      <span className="text-white/40">{new Date(slot.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Event Detail Sheet */}
      <Sheet open={!!showEventDetail} onOpenChange={() => setShowEventDetail(null)}>
        <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto border-l-primary/10 bg-background/95 backdrop-blur-xl">
          {showEventDetail && (
            <>
              <SheetHeader>
                <SheetTitle className="text-lg font-bold">{showEventDetail.title}</SheetTitle>
                <SheetDescription>{showEventDetail.provider} · {STATUS_CONFIG[showEventDetail.status]?.label || showEventDetail.status}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                <div className="flex items-center gap-3">
                  <Badge className={cn("text-[10px]", STATUS_CONFIG[showEventDetail.status]?.color)}>
                    {STATUS_CONFIG[showEventDetail.status]?.icon}
                    <span className="ml-1">{STATUS_CONFIG[showEventDetail.status]?.label}</span>
                  </Badge>
                  {showEventDetail.isAiBooked && (
                    <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]">
                      <Bot className="h-2.5 w-2.5 mr-1" /> AI Booked
                    </Badge>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <CalendarIcon className="h-4 w-4 text-white/30" />
                    <span className="text-white/60">{new Date(showEventDetail.startTime).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="h-4 w-4 text-white/30" />
                    <span className="text-white/60">
                      {new Date(showEventDetail.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      {' - '}
                      {new Date(showEventDetail.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {showEventDetail.attendeeEmail && (
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-white/30" />
                      <span className="text-white/60">{showEventDetail.attendeeEmail}</span>
                    </div>
                  )}
                  {showEventDetail.leadName && (
                    <div className="flex items-center gap-3 text-sm">
                      <User className="h-4 w-4 text-white/30" />
                      <span className="text-white/60">{showEventDetail.leadName}</span>
                    </div>
                  )}
                </div>

                {showEventDetail.intentScore != null && (
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/10">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40">Intent Score</span>
                      <span className="text-sm font-bold text-purple-400">{showEventDetail.intentScore}%</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" style={{ width: `${showEventDetail.intentScore}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  {showEventDetail.meetingUrl && (
                    <Button asChild className="flex-1 rounded-xl bg-primary text-primary-foreground">
                      <a href={showEventDetail.meetingUrl} target="_blank" rel="noopener noreferrer">
                        <Video className="mr-2 h-4 w-4" /> Join Meeting
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10"
                    onClick={() => setShowShareDialog(showEventDetail)}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Settings Sheet */}
      <Sheet open={showSettingsSheet} onOpenChange={setShowSettingsSheet}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto border-l-primary/10 bg-background/95 backdrop-blur-xl">
          <SheetHeader>
            <SheetTitle className="text-xl font-bold">Calendar Settings</SheetTitle>
            <SheetDescription>Configure calendar connections and AI booking</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 py-6">
            {/* Connections */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-2">
                <LinkIcon className="h-3 w-3" /> Connections
              </h3>
              <Card className="border-white/5 bg-white/[0.02] rounded-xl">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <CalendarIcon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Calendly</p>
                      <p className="text-[10px] text-white/40">{settings?.calendlyEnabled ? settings.calendlyUsername || 'Connected' : 'Not connected'}</p>
                    </div>
                  </div>
                  {settings?.calendlyEnabled ? (
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 text-xs" onClick={() => disconnectCalendlyMutation.mutate()}>Disconnect</Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" className="rounded-lg text-xs" onClick={() => connectCalendlyOAuthMutation.mutate()}>Connect Calendly</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="border-white/5 bg-white/[0.02] rounded-xl">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                      <Globe className="h-4 w-4 text-indigo-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Google Calendar</p>
                      <p className="text-[10px] text-white/40">{settings?.googleCalendarEnabled ? 'Connected' : 'Not connected'}</p>
                    </div>
                  </div>
                  {settings?.googleCalendarEnabled ? (
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 text-xs" onClick={() => disconnectGoogleMutation.mutate()}>Disconnect</Button>
                  ) : (
                    <Button size="sm" className="rounded-lg text-xs" onClick={() => connectGoogleMutation.mutate()}>Connect</Button>
                  )}
                </CardContent>
              </Card>
            </div>

            <Separator className="bg-white/5" />

            {/* AI Booking */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-2">
                <Brain className="h-3 w-3" /> AI Booking
              </h3>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-white">Automated Booking</p>
                  <p className="text-[10px] text-white/30">AI books meetings for high-intent leads</p>
                </div>
                <Switch checked={settings?.autoBookingEnabled} onCheckedChange={(c) => updateSettingsMutation.mutate({ autoBookingEnabled: c })} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label className="text-white/60">Min Intent Score</Label>
                  <span className="text-primary font-bold">{settings?.minIntentScore}%</span>
                </div>
                <Slider value={[settings?.minIntentScore || 70]} max={100} step={5} onValueChange={([v]) => updateSettingsMutation.mutate({ minIntentScore: v })} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Meeting Duration</Label>
                <Select value={String(settings?.meetingDuration || 30)} onValueChange={(v) => updateSettingsMutation.mutate({ meetingDuration: Number(v) })}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-lg h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="45">45 min</SelectItem>
                    <SelectItem value="60">60 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator className="bg-white/5" />

            {/* Working Hours */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-2">
                <Timer className="h-3 w-3" /> Working Hours
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-white/40">Start</Label>
                  <Select value={String(settings?.workingHoursStart || 9)} onValueChange={(v) => updateSettingsMutation.mutate({ workingHoursStart: Number(v) })}>
                    <SelectTrigger className="bg-white/5 border-white/10 rounded-lg h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-white/40">End</Label>
                  <Select value={String(settings?.workingHoursEnd || 17)} onValueChange={(v) => updateSettingsMutation.mutate({ workingHoursEnd: Number(v) })}>
                    <SelectTrigger className="bg-white/5 border-white/10 rounded-lg h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-white/40">Timezone</Label>
                <Select value={settings?.timezone || 'America/New_York'} onValueChange={(v) => updateSettingsMutation.mutate({ timezone: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-lg h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map(tz => (
                      <SelectItem key={tz} value={tz}>{tz.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-white/40">Buffer Before (min)</Label>
                  <Input type="number" value={settings?.bufferBefore || 10} onChange={(e) => updateSettingsMutation.mutate({ bufferBefore: Number(e.target.value) })} className="bg-white/5 border-white/10 rounded-lg h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-white/40">Buffer After (min)</Label>
                  <Input type="number" value={settings?.bufferAfter || 5} onChange={(e) => updateSettingsMutation.mutate({ bufferAfter: Number(e.target.value) })} className="bg-white/5 border-white/10 rounded-lg h-9 text-sm" />
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Create Event Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="rounded-2xl border-white/10 bg-background/95 backdrop-blur-xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">New Event</DialogTitle>
            <DialogDescription>Schedule a new calendar event</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input placeholder="Event title" className="rounded-xl bg-white/5 border-white/10" value={newEvent.summary} onChange={(e) => setNewEvent({ ...newEvent, summary: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-white/40">Start</Label>
                <Input type="datetime-local" className="rounded-xl bg-white/5 border-white/10 text-sm" value={newEvent.startTime} onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-white/40">End</Label>
                <Input type="datetime-local" className="rounded-xl bg-white/5 border-white/10 text-sm" value={newEvent.endTime} onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })} />
              </div>
            </div>
            <Input placeholder="Attendee email" className="rounded-xl bg-white/5 border-white/10" value={newEvent.attendeeEmail} onChange={(e) => setNewEvent({ ...newEvent, attendeeEmail: e.target.value })} />
            <Textarea placeholder="Description (optional)" className="rounded-xl bg-white/5 border-white/10 min-h-[80px]" value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} />
            <Button className="w-full rounded-xl h-11" onClick={() => createEventMutation.mutate(newEvent)} disabled={!newEvent.summary || !newEvent.startTime}>
              Create Event
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Share Booking Link Dialog */}
      <Dialog open={!!showShareDialog} onOpenChange={() => setShowShareDialog(null)}>
        <DialogContent className="rounded-2xl border-white/10 bg-background/95 backdrop-blur-xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Share Booking Link</DialogTitle>
            <DialogDescription>Send this link for {showShareDialog?.leadName || 'the lead'} to book</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs text-white/40 break-all">
                {(settings as any)?.calendarLink || 'No booking link configured'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl border-white/10 bg-white/5" onClick={copyBookingLink}>
                {copiedLink ? <Check className="mr-2 h-4 w-4 text-emerald-400" /> : <Copy className="mr-2 h-4 w-4" />}
                {copiedLink ? "Copied" : "Copy Link"}
              </Button>
              <Button variant="outline" className="rounded-xl border-white/10 bg-white/5" asChild>
                <a href={(settings as any)?.calendarLink || '#'} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
