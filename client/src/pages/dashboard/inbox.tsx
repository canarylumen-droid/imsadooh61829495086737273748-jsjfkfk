
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRealtime } from "@/hooks/use-realtime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { Skeleton } from "@/components/ui/skeleton";
import { useParams, useLocation } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import DOMPurify from "dompurify";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getLeadStatusDisplay } from "@/lib/lead-status";
import { formatDateShort, formatTimeOnly } from "@/lib/format-date";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMailbox } from "@/hooks/use-mailbox";
import { LeadIntelligenceModal } from "@/components/dashboard/LeadIntelligenceModal";
import { CustomContextMenu, useContextMenu } from "@/components/ui/interactive/CustomContextMenu";
import UnifiedCampaignWizard from "@/components/outreach/UnifiedCampaignWizard";
import { CampaignListModal } from "@/components/outreach/CampaignListModal";
import { LeadProcessModal } from "@/components/dashboard/LeadProcessModal";
import { PageWrapper } from "@/components/ui/page-wrapper";
import {
  Search,
  Trash2,
  Archive,
  Inbox as InboxIcon,
  Star,
  Instagram,
  Mail,
  RefreshCw,
  Check,
  Send,
  Sparkles,
  Clock,
  MessageSquare,
  Loader2,
  X,
  Activity,
  Brain,
  ExternalLink,
  User,
  Phone,
  Plug,
  Facebook,
  MapPin,
  Tags,
  Download,
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Filter,
  Zap,
  Wand2,
  AlertCircle
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from "@/components/ui/tooltip";

const channelIcons = {
  instagram: Instagram,
  email: Mail,
  gmail: SiGoogle,
  outlook: Mail
};

const DEFAULT_PERSONALIZATION_TAGS = [
  { label: "First Name", value: "{{firstName}}" },
  { label: "Last Name", value: "{{lastName}}" },
  { label: "Company", value: "{{company}}" },
  { label: "City", value: "{{city}}" },
  { label: "Industry", value: "{{industry}}" },
  { label: "Niche", value: "{{niche}}" },
  { label: "Website", value: "{{website}}" },
];

const statusStyles = {
  new: "bg-primary/20 text-primary border-primary/20",
  contacted: "bg-primary/10 text-primary border-primary/10",
  opened: "bg-primary/10 text-primary border-primary/10",
  replied: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  booked: "bg-sky-500/10 text-sky-500 border-sky-500/20 shadow-[0_0_10px_rgba(14,165,233,0.15)]",
  converted: "bg-primary/20 text-primary border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)]",
  warm: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  not_interested: "bg-muted text-muted-foreground border-muted",
  cold: "bg-muted text-muted-foreground border-muted",
};

export default function InboxPage() {
  let { id: leadId } = useParams();
  const [location, setLocation] = useLocation();
  // Fallback: extract leadId from URL path if useParams doesn't match
  if (!leadId) {
    const match = location.match(/\/dashboard\/inbox\/(.+)/);
    if (match) leadId = match[1];
  }
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedMailboxId } = useMailbox();
  const [processLead, setProcessLead] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const enableRegex = searchQuery ? (searchQuery.startsWith('/') && searchQuery.endsWith('/')) : false;
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const hasLoadedLeadsRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isCampaignListOpen, setIsCampaignListOpen] = useState(false);

  // Handle Global Search params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) {
      setSearchQuery(q);
      // Optional: clear the URL so it doesn't persist forever
      // window.history.replaceState({}, '', '/dashboard/inbox'); 
    }
  }, []);

  // Message Thread State
  const [replyMessage, setReplyMessage] = useState("");
  const [isPolishing, setIsPolishing] = useState(false);
  const [showIntelligence, setShowIntelligence] = useState(false);
  const [grammarErrors, setGrammarErrors] = useState<any[]>([]);
  const [isCheckingGrammar, setIsCheckingGrammar] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [showDetails, setShowDetails] = useState(false); // Controls the right sidebar
  const [typingLeadId, setTypingLeadId] = useState<string | null>(null); // Track which lead is typing
  const [localDrafts, setLocalDrafts] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const leadListRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT = 90;
  const BUFFER = 10;

  const [activeReplyTab, setActiveReplyTab] = useState<'text'>('text');

  // Load drafts on mount
  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('draft_')) {
        const val = localStorage.getItem(key);
        if (val) drafts[key.replace('draft_', '')] = val;
      }
    }
    setLocalDrafts(drafts);
  }, []);

  // Handle lead change: focus textarea and load draft
  useEffect(() => {
    if (leadId) {
      if (localDrafts[leadId]) {
        setReplyMessage(localDrafts[leadId]);
      } else {
        setReplyMessage("");
      }

      // Auto-focus when switching to a lead thread
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
    }
  }, [leadId]); // Depend only on leadId initially so we don't reset while typing

  const { contextConfig, handleContextMenu, closeMenu } = useContextMenu();

  const { data: user } = useQuery<any>({ queryKey: ["/api/user/profile"] });

  const { socket, isSyncing: backendSyncing } = useRealtime();
  const [syncStatus, setSyncStatus] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!socket) return;
    
    // Listen for sync health updates from the server
    const onSyncStatus = (data: any) => {
      setSyncStatus(prev => ({
        ...prev,
        [data.integrationId]: data
      }));
    };

    socket.on('sync:status', onSyncStatus);
    return () => {
      socket.off('sync:status', onSyncStatus);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleMessagesUpdated = (payload: any) => {
      // payload could be { message }, { leadId }, or { event, count, integrationId, provider }
      const msgData = payload?.message || payload || {};
      const targetLeadId = msgData.leadId || payload?.leadId;
      const targetIntegrationId = payload?.integrationId;

      // Real-time synchronization check: if this sync event is for our CURRENT selected mailbox, refresh!
      if (targetIntegrationId === selectedMailboxId) {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        if (leadId) {
          queryClient.invalidateQueries({ queryKey: ["/api/messages", leadId] });
        }
      }

      if (!targetLeadId) {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        if (leadId) {
          queryClient.invalidateQueries({ queryKey: ["/api/messages", leadId] });
        }
        return;
      }

      // 20ms UI Push: Instantly move lead to top and update snippet
      setAllLeads(prev => {
        const leadIndex = prev.findIndex(l => l.id === targetLeadId);
        if (leadIndex === -1) return prev;

        const updatedLead = {
          ...prev[leadIndex],
          lastMessageAt: new Date().toISOString(),
          snippet: msgData.content || msgData.snippet || prev[leadIndex].snippet,
          metadata: { ...prev[leadIndex].metadata, isUnread: true }
        };

        const otherLeads = prev.filter(l => l.id !== targetLeadId);
        return [updatedLead, ...otherLeads]; // PUSH TO TOP
      });

      // 20ms UI Push: Instantly add message to the exact thread if currently viewing
      if (targetLeadId === leadId && msgData.id) {
        queryClient.setQueriesData(
          { queryKey: ["/api/messages", targetLeadId] },
          (oldData: any) => {
            if (!oldData || !oldData.messages) return oldData;
            const exists = oldData.messages.some((m: any) => m.id === msgData.id);
            if (exists) return oldData;

            const newMsg = {
              id: msgData.id || `temp-${Date.now()}`,
              body: msgData.body || msgData.content || '',
              content: msgData.content || msgData.body || '',
              direction: msgData.direction || 'inbound',
              createdAt: msgData.createdAt || new Date().toISOString(),
              userId: user?.id,
              leadId: targetLeadId,
              metadata: msgData.metadata || {}
            };
            return {
              ...oldData,
              messages: [...oldData.messages, newMsg]
            };
          }
        );
      }

      // Invalidate specific lead's messages for consistency
      if (payload?.event === 'DELETE' && payload.messageIds) {
        queryClient.setQueriesData(
          { queryKey: ["/api/messages", targetLeadId] },
          (oldData: any) => {
            if (!oldData || !oldData.messages) return oldData;
            return {
              ...oldData,
              messages: oldData.messages.filter((m: any) => !payload.messageIds.includes(m.id))
            };
          }
        );
      }

      queryClient.invalidateQueries({ queryKey: ["/api/messages", targetLeadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });

      // Auto-scroll if we are currently viewing the thread
      if (targetLeadId === leadId) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    };

    let notifTimeout: NodeJS.Timeout;
    const handleNotification = (data: any) => {
      if (data?.type === 'lead_import') {
        clearTimeout(notifTimeout);
        notifTimeout = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          toast({ title: "Leads Imported", description: "Your inbox has been updated with new leads." });
        }, 1500);
      }
    };

    const handleActivityUpdated = (data: any) => {
      if (data?.type === 'typing_status' && data.channel === 'instagram') {
        if (data.status === 'typing_on') {
          setTypingLeadId((prev: any) => prev === data.leadId ? null : prev);
          // Auto-clear after 5 seconds just in case 'typing_off' is missed
          setTimeout(() => setTypingLeadId(null), 5000);
        } else {
          setTypingLeadId(null);
        }
      }
    };

    const handleLeadsUpdated = (payload: any) => {
      if (payload?.event === 'BULK_DELETE' && payload.leadIds) {
        setAllLeads(prev => prev.filter(l => !payload.leadIds.includes(l.id)));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    };

    let leadsTimeout: NodeJS.Timeout | null = null;

    socket.on('messages_updated', handleMessagesUpdated);
    socket.on('leads_updated', handleLeadsUpdated);
    socket.on('notification', handleNotification);
    socket.on('activity_updated', handleActivityUpdated);

    socket.on("messages", handleMessagesUpdated);
    socket.on("leads", handleLeadsUpdated);
    socket.on("message", handleMessagesUpdated);
    socket.on("message_received", handleMessagesUpdated);
    socket.on("message_sent", handleMessagesUpdated);

    return () => {
      socket.off('messages_updated', handleMessagesUpdated);
      socket.off('leads_updated', handleLeadsUpdated);
      socket.off('notification', handleNotification);
      socket.off('activity_updated', handleActivityUpdated);

      socket.off("messages", handleMessagesUpdated);
      socket.off("leads", handleLeadsUpdated);
      socket.off("message", handleMessagesUpdated);
      socket.off("message_received", handleMessagesUpdated);
      socket.off("message_sent", handleMessagesUpdated);

      if (leadsTimeout) clearTimeout(leadsTimeout);
      if (notifTimeout) clearTimeout(notifTimeout);
    };
  }, [socket, leadId, queryClient, toast, selectedMailboxId, user]);



  const [showArchived, setShowArchived] = useState(false);
  const hasArchivedLeads = useMemo(() => allLeads.some(l => l.archived), [allLeads]);
  useEffect(() => {
    if (showArchived && !hasArchivedLeads && hasLoadedLeadsRef.current) {
      setShowArchived(false);
    }
  }, [showArchived, hasArchivedLeads]);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const simpleStatuses = ['new', 'contacted', 'converted', 'not_interested'];

  const { data: leadsData, isLoading: leadsLoading, isFetching: leadsFetching } = useQuery<any>({
    queryKey: ["/api/leads", {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      includeArchived: showArchived,
      integrationId: selectedMailboxId,
      search: searchQuery || undefined,
      channel: filterChannel !== "all" ? filterChannel : undefined,
      status: simpleStatuses.includes(filterStatus) ? filterStatus : undefined,
    }],
    placeholderData: (prev: any) => prev,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: messagesData, isLoading: messagesLoading, isFetching: messagesFetching } = useQuery<any>({
    queryKey: ["/api/messages", leadId, { integrationId: selectedMailboxId }],
    enabled: !!leadId,
    placeholderData: (prev: any) => prev,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: channelStatus, isLoading: channelsLoading } = useQuery<any>({
    queryKey: ["/api/channels/all"],
    placeholderData: (prev: any) => prev,
  });

  const isChannelConnected = (channel?: string) => {
    // Zero-Pause Architecture: Never block the UI due to transient connection states.
    // Allow messages to queue and auto-recover in the background.
    return true;
  };

  const hasAnyChannel = useMemo(() => {
    if (channelsLoading) return undefined;
    if (!channelStatus?.channels) return false;
    return channelStatus.channels.email?.connected || channelStatus.channels.instagram?.connected;
  }, [channelStatus, channelsLoading]);

  const showDisconnectedAlert = !channelsLoading && !leadsLoading && hasAnyChannel === false && allLeads.length > 0;
  const isSyncing = leadsFetching || channelsLoading;

  const activeLead = useMemo(() =>
    leadsData?.leads?.find((l: any) => l.id === leadId) || allLeads.find((l: any) => l.id === leadId),
    [leadsData, allLeads, leadId]
  );

  useEffect(() => {
    if (Array.isArray(leadsData?.leads)) {
      setTypingLeadId(null);
      setAllLeads(prev => {
        if (page === 0) return leadsData.leads;
        const existingIds = new Set(prev.map(l => l.id));
        const newOnes = leadsData.leads.filter((l: any) => !existingIds.has(l.id));
        return [...prev, ...newOnes];
      });
      hasLoadedLeadsRef.current = true;
    }
  }, [leadsData]);

  // Dynamic Tags for variables insertion
  const allTags = useMemo(() => {
    const dynamicTags = activeLead?.metadata ? 
      Object.keys(activeLead.metadata)
        .filter(k => !k.endsWith('_type') && k !== '_unmapped_cols')
        .map(k => ({ label: k.replace(/_/g, ' '), value: `{{${k}}}` })) : 
      [];
    return [...DEFAULT_PERSONALIZATION_TAGS, ...dynamicTags.filter(dt => !DEFAULT_PERSONALIZATION_TAGS.some(st => st.value === dt.value))];
  }, [activeLead]);

  const insertTag = (tag: string) => {
    setReplyMessage(prev => prev + tag);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Handle clearing unread status and status transition when lead is selected
  useEffect(() => {
    if (leadId) {
      // Clear lead-specific notifications on the server
      apiRequest("POST", `/api/messages/${leadId}/read`).catch(() => {});

      if (activeLead?.metadata?.isUnread) {
        const { isUnread, ...restMetadata } = activeLead.metadata;
        apiRequest("PATCH", `/api/leads/${leadId}`, {
          metadata: restMetadata
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        });
      }

      // Always refresh notifications when a lead is opened
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setGrammarErrors([]); // Reset grammar on lead switch

      // Load specific lead draft from local storage
      const savedDraft = localStorage.getItem(`draft_${leadId}`);
      if (savedDraft) {
        setReplyMessage(savedDraft);
      } else {
        setReplyMessage("");
      }
    } else {
      setReplyMessage("");
    }
  }, [leadId, activeLead?.id, activeLead?.status, queryClient]); // Added activeLead?.status to dependencies

  const filteredLeads = useMemo(() => {
    // Build regex once for faster search
    const searchPattern = enableRegex ? searchQuery.slice(1, -1) : searchQuery?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || '';
    const searchRegex = searchQuery ? new RegExp(searchPattern, 'i') : null;

    return allLeads.filter((lead: any) => {
      const matchesSearch = !searchRegex ||
        searchRegex.test(lead.name || '') ||
        searchRegex.test(lead.email || '') ||
        searchRegex.test(lead.company || '') ||
        searchRegex.test(lead.snippet || '') ||
        searchRegex.test(lead.subject || '');

      const matchesChannel = filterChannel === "all" || lead.channel === filterChannel;

      let matchesStatus = true;
      if (filterStatus !== "all") {
        if (filterStatus === "unread") {
          matchesStatus = !!lead.metadata?.isUnread;
        } else if (filterStatus === "inventory") {
          // Explicit filter for Lead Inventory (unassigned)
          matchesStatus = !lead.integrationId;
        } else if (filterStatus === "read") {
          matchesStatus = !lead.metadata?.isUnread;
        } else if (filterStatus === "warm") {
          // Warm = Warm OR Booked OR Score > 50
          matchesStatus = ['warm', 'booked'].includes(lead.status) || (lead.score && lead.score > 50) || lead.metadata?.isWarm;
        } else if (filterStatus === "replied") {
          matchesStatus = ['replied', 'warm', 'booked'].includes(lead.status);
        } else if (filterStatus === "opened") {
          matchesStatus = !!lead.metadata?.openedCount || !!lead.metadata?.openedAt || lead.metadata?.opened === true || lead.status === 'opened' || lead.status === 'contacted';
        } else if (filterStatus === "contacted") {
          matchesStatus = lead.status === 'contacted' || lead.status === 'opened';
        } else if (filterStatus === "cold") {
          matchesStatus = lead.status === 'cold';
        } else if (filterStatus === "booked") {
          matchesStatus = ['booked', 'converted'].includes(lead.status);
        } else {
          matchesStatus = lead.status === filterStatus;
        }
      }

      const matchesArchived = showArchived ? lead.archived : !lead.archived;
      
      // Strict UI Separation Logic:
      // 1. If 'inventory' filter is active: Show ONLY unassigned leads.
      // 2. If a specific mailbox is selected: Show ONLY its leads (no inventory).
      // 3. If 'All Chats' is active and NO mailbox selected: Show everything.
      
      let matchesMailbox = true;
      if (filterStatus === "inventory") {
        matchesMailbox = !lead.integrationId;
      } else if (selectedMailboxId) {
        matchesMailbox = !lead.integrationId || lead.integrationId === selectedMailboxId;
      } else {
        // "All Chats" view with no mailbox filter: show all for visibility
        matchesMailbox = true;
      }

      return matchesSearch && matchesChannel && matchesStatus && matchesArchived && matchesMailbox;
    }).sort((a: any, b: any) => {
      const hasDraftA = !!localDrafts[a.id];
      const hasDraftB = !!localDrafts[b.id];

      if (hasDraftA && !hasDraftB) return -1;
      if (!hasDraftA && hasDraftB) return 1;

      const timeA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });
  }, [allLeads, searchQuery, filterChannel, filterStatus, showArchived, localDrafts, selectedMailboxId]);

  const [virtualRange, setVirtualRange] = useState({ start: 0, end: 50 });
  const virtualStart = virtualRange.start;
  const virtualEnd = virtualRange.end;
  useEffect(() => {
    const el = leadListRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrollTop = el.scrollTop;
      const viewH = el.clientHeight;
      const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
      const end = Math.min(filteredLeads.length, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + BUFFER);
      setVirtualRange({ start, end });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [filteredLeads.length]);

  // Detect if a message body contains HTML
  const isHtml = (text: string) => /<[a-z][\s\S]*>/i.test(text);

  // Highlighting helper
  const HighlightText = useCallback(({ text, query }: { text: string, query: string }) => {
    if (!query) return <>{text}</>;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ?
            <mark key={i} className="bg-primary/30 text-foreground rounded-sm px-0.5">{part}</mark> :
            part
        )}
      </span>
    );
  }, []);

  // Real-time Grammar Check Logic
  useEffect(() => {
    if (!replyMessage || replyMessage.length < 5) {
      setGrammarErrors([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingGrammar(true);
      try {
        const res = await apiRequest("POST", "/api/ai/check-grammar", { text: replyMessage });
        const data = await res.json();
        setGrammarErrors(data.errors || []);
      } catch (err) {
        console.error("Grammar check failed:", err);
      } finally {
        setIsCheckingGrammar(false);
      }
    }, 1500); // 1.5s debounce

    return () => clearTimeout(timer);
  }, [replyMessage]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const body: any = { content, channel: activeLead?.channel };
      // Send a fallback subject so backend doesn't need AI generation
      if (activeLead?.subject && !activeLead.subject.includes('{{')) {
        body.subject = activeLead.subject.replace(/^Re:\s*/i, 'Re: ');
      } else {
        body.subject = `Re: ${activeLead?.name || 'Follow up'}`;
      }
      return apiRequest("POST", `/api/messages/${leadId}`, body);
    },
    onMutate: async (newContent) => {
      sendInFlightRef.current = true;
      await queryClient.cancelQueries({ queryKey: ["/api/messages", leadId] });

      const previousMessages = queryClient.getQueriesData({ queryKey: ["/api/messages", leadId] });
      const previousLeads = allLeads;
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg = {
        id: tempId,
        body: newContent,
        content: newContent,
        direction: 'outbound',
        createdAt: new Date().toISOString(),
        userId: user?.id,
        leadId,
        subject: activeLead?.subject?.replace(/^{{[^}]+}}$/g, '') || undefined,
        metadata: { optimistic: true }
      };

      queryClient.setQueriesData(
        { queryKey: ["/api/messages", leadId] },
        (oldData: any) => ({
          ...(oldData || { messages: [], total: 0, hasMore: false }),
          messages: [...(oldData?.messages || []), optimisticMsg],
          total: (oldData?.total || oldData?.messages?.length || 0) + 1,
        })
      );

      setAllLeads(prev => prev.map((lead: any) =>
        lead.id === leadId
          ? {
              ...lead,
              snippet: newContent,
              lastMessageAt: new Date().toISOString(),
              status: lead.status === "new" ? "contacted" : lead.status,
              metadata: { ...lead.metadata, isUnread: false },
            }
          : lead
      ));

      setReplyMessage("");
      if (leadId) localStorage.removeItem(`draft_${leadId}`);

      return { previousMessages, previousLeads, tempId };
    },
    onError: (_err, _newContent, context) => {
      context?.previousMessages?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context?.previousLeads) setAllLeads(context.previousLeads);
      toast({ title: "Failed to send", variant: "destructive" });
    },
    onSuccess: async (res, _newContent, context) => {
      const data = await res.json().catch(() => null);
      if (!data?.message || !context?.tempId) return;
      queryClient.setQueriesData(
        { queryKey: ["/api/messages", leadId] },
        (oldData: any) => ({
          ...(oldData || { messages: [], total: 0, hasMore: false }),
          messages: (oldData?.messages || []).map((msg: any) =>
            msg.id === context.tempId ? { ...data.message, subject: msg.subject } : msg
          ),
        })
      );
    },
    onSettled: () => {
      sendInFlightRef.current = false;
    }
  });

  const submitReply = useCallback(() => {
    const message = replyMessage.trim();
    if (!message || sendMutation.isPending || sendInFlightRef.current) return;
    sendMutation.mutate(message);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [replyMessage, sendMutation]);

  const handleAI = async () => {
    if (replyMessage.trim()) {
      if (isPolishing) return;
      setIsPolishing(true);
      try {
        const res = await fetch("/api/leads/magic-pencil", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: replyMessage,
            tone: activeLead?.metadata?.tone || 'professional',
            context: activeLead?.name ? `Replying to ${activeLead.name} from ${activeLead.company || 'unknown company'}` : 'Sales reply'
          })
        });
        const data = await res.json();
        if (data.rewrittenText) {
          setReplyMessage(data.rewrittenText);
          toast({ title: "✨ Message Polished", description: "AI has refined your response for maximum conversion." });
        }
      } catch (err) {
        toast({ variant: "destructive", title: "AI Error", description: "Could not refine message at this time." });
      } finally {
        setIsPolishing(false);
      }
    } else {
      if (isGenerating) return;
      setIsGenerating(true);
      setTypedText("");
      try {
        const res = await apiRequest("POST", `/api/leads/draft-reply/${leadId}`);
        const data = await res.json();
        const aiSuggestion = data.draft || data.aiSuggestion || data.content || "";

        let index = 0;
        const interval = setInterval(() => {
          if (index < aiSuggestion.length) {
            setTypedText(aiSuggestion.slice(0, index + 1));
            index++;
          } else {
            clearInterval(interval);
            setReplyMessage(aiSuggestion);
            setIsGenerating(false);
            setTypedText("");
          }
        }, 10);
      } catch (err) {
        toast({ title: "AI Error", description: "Failed to generate reply", variant: "destructive" });
        setIsGenerating(false);
      }
    }
  };

  const [metadataEditMode, setMetadataEditMode] = useState(false);
  const [editedMetadata, setEditedMetadata] = useState<Record<string, any>>({});

  const updateLead = useMutation({
    mutationFn: async (data: { id: string;[key: string]: any }) => {
      const { id, ...updateData } = data;
      const res = await apiRequest("PATCH", `/api/leads/${id}`, updateData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}`] });
      setMetadataEditMode(false);
      toast({ title: "Lead updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update lead", variant: "destructive" });
    }
  });

  const toggleAi = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      await apiRequest("PATCH", `/api/leads/${id}`, { aiPaused: paused });
    },
    onMutate: async ({ id, paused }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/leads"] });
      const previousLeads = allLeads;
      setAllLeads(prev => prev.map((lead: any) => lead.id === id ? { ...lead, aiPaused: paused } : lead));
      return { previousLeads };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLeads) setAllLeads(context.previousLeads);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/leads"] })
  });

  const handleMenuAction = useCallback(async (action: string, data: any) => {
    if (action === 'archive') {
      // Optimistic update
      setAllLeads(prev => prev.filter(l => l.id !== data.id));
      if (leadId === data.id) {
        setLocation('/dashboard/inbox');
      }

      try {
        await apiRequest("POST", "/api/bulk/archive", {
          leadIds: [data.id],
          archived: true
        });
        toast({ title: "Lead Archived", description: "Successfully moved to archive" });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      } catch (err) {
        // Revert on failure
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        toast({ title: "Error", description: "Failed to archive lead", variant: "destructive" });
      }
    } else if (action === 'unarchive') {
      try {
        await apiRequest("POST", "/api/bulk/archive", {
          leadIds: [data.id],
          archived: false
        });
        // Optimistic update
        setAllLeads(prev => prev.filter(l => l.id !== data.id));
        if (leadId === data.id) {
          setLocation('/dashboard/inbox');
        }
        toast({ title: "Lead Restored", description: "Successfully restored from archive" });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      } catch (err) {
        toast({ title: "Error", description: "Failed to unarchive lead", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      }
    } else if (action === 'delete') {
      if (confirm(`Are you sure you want to delete ${data.name}? This action cannot be undone.`)) {
        // Optimistic UI updates
        setAllLeads(prev => prev.filter(l => l.id !== data.id));
        if (leadId === data.id) {
          setLocation('/dashboard/inbox');
        }

        try {
          await apiRequest("POST", "/api/bulk/delete", {
            leadIds: [data.id]
          });
          toast({ title: "Lead Deleted", description: "Lead has been permanently removed" });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        } catch (err) {
          // Revert on failure (optional, but good practice would be to re-fetch)
          toast({ title: "Error", description: "Failed to delete lead", variant: "destructive" });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        }
      }
    } else if (action === 'mark_unread') {
      // Optimistic state update
      setAllLeads(prev => prev.map(l => l.id === data.id ? { ...l, metadata: { ...l.metadata, isUnread: true } } : l));

      try {
        const currentMetadata = data.metadata || {};
        await apiRequest("PATCH", `/api/leads/${data.id}`, {
          metadata: { ...currentMetadata, isUnread: true }
        });
        toast({ title: "Marked as Unread", description: "This conversation will appear as unread" });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      } catch (err) {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        toast({ title: "Error", description: "Failed to mark as unread", variant: "destructive" });
      }
    } else if (action === 'copy_details') {
      const details = `Name: ${data.name}\nEmail: ${data.email || 'N/A'}\nPhone: ${data.phone || 'N/A'}\nCompany: ${data.company || 'N/A'}`;
      navigator.clipboard.writeText(details);
      toast({ title: "Copied!", description: "Lead details copied to clipboard" });
    } else if (action === 'mark_booked') {
      try {
        await apiRequest("PATCH", `/api/leads/${data.id}`, { status: 'booked' });
        toast({ title: "Lead Booked", description: `${data.name} has been marked as booked` });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      } catch (err) {
        toast({ title: "Error", description: "Failed to mark lead as booked", variant: "destructive" });
      }
    }
  }, [toast, queryClient, leadId, setLocation]);

  const handleSaveMetadata = async () => {
    if (!activeLead || !leadId) return;

    // Merge new social links with existing metadata to prevent data loss
    const currentMetadata = activeLead.metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      socialLinks: {
        ...(currentMetadata.socialLinks || {}),
        ...editedMetadata
      }
    };

    updateLead.mutate({ id: leadId, metadata: updatedMetadata }, {
      onSuccess: () => setMetadataEditMode(false)
    });
  };

  const handleBulkAction = async (action: 'archive' | 'delete') => {
    if (selectedLeadIds.length === 0) return;

    if (action === 'delete' && !confirm(`Delete ${selectedLeadIds.length} selected leads?`)) return;

    try {
      // Optimistic UI updates for delete
      if (action === 'delete') {
        setAllLeads(prev => prev.filter(l => !selectedLeadIds.includes(l.id)));
        if (leadId && selectedLeadIds.includes(leadId)) {
          setLocation('/dashboard/inbox');
        }
        setSelectedLeadIds([]);
      }

      const endpoint = action === 'delete' ? '/api/bulk/delete' : '/api/bulk/archive';
      const body = action === 'delete' ? { leadIds: selectedLeadIds } : { leadIds: selectedLeadIds, archived: true };

      await apiRequest("POST", endpoint, body);

      toast({
        title: `Bulk ${action === 'delete' ? 'Delete' : 'Archive'}`,
        description: `Successfully processed ${selectedLeadIds.length} leads`
      });

      if (action !== 'delete') setSelectedLeadIds([]); // Clear selection for archive too if successful
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch (err) {
      toast({ title: "Error", description: "Bulk action failed", variant: "destructive" });
    }
  };

  const toggleLeadSelection = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedLeadIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const bookCallMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/leads/calendar/${leadId}`, { sendMessage: true });
    },
    onSuccess: () => {
      toast({ title: "Booking link sent!", description: `Calendar invite sent to ${activeLead?.name}` });
      queryClient.invalidateQueries({ queryKey: ["/api/messages", leadId] });
    }
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messagesData?.messages, isGenerating, typedText]);

  const ChannelIcon = activeLead ? (channelIcons[activeLead.channel as keyof typeof channelIcons] || Instagram) : Instagram;

  return (
    <PageWrapper className="flex h-[100dvh] w-full overflow-hidden bg-background relative p-0 m-0 max-w-none space-y-0 duration-700">
      <div className="flex w-full h-full max-w-[1600px] mx-auto bg-card border-0 md:border md:rounded-3xl overflow-hidden shadow-2xl">
        {/* Lead List Pane */}
        <div className={cn(
          "w-full sm:w-72 md:w-80 lg:w-[350px] border-r flex flex-col transition-all shrink-0 h-[100dvh] md:h-full bg-background",
          leadId && "hidden md:flex"
        )}>
          <div className="p-4 border-b space-y-4 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Inbox</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Status Filter Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted">
                      <Filter className={cn("h-4 w-4", filterStatus !== 'all' ? "text-primary" : "text-muted-foreground")} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setFilterStatus("all")} className="cursor-pointer font-medium">All Chats</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("inventory")} className="cursor-pointer font-medium text-primary flex items-center gap-2">
                       <Plug className="h-3.5 w-3.5" /> Lead Inventory
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("unread")} className="cursor-pointer font-medium">Unread</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("read")} className="cursor-pointer font-medium">Read</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("opened")} className="cursor-pointer font-medium text-sky-400">Opened (Pixel tracked)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("contacted")} className="cursor-pointer font-medium text-primary">Contacted</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("replied")} className="cursor-pointer font-medium text-emerald-500">Replied</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("warm")} className="cursor-pointer font-medium text-orange-500">Warm (Engaged)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("cold")} className="cursor-pointer font-medium text-muted-foreground">Cold (No Reply)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("booked")} className="cursor-pointer font-medium text-sky-500">Booked / Converted</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("not_interested")} className="cursor-pointer font-medium text-destructive/70">Not Interested</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setFilterStatus("bouncy")} className="cursor-pointer font-medium text-amber-500">Bounced</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterStatus("unsubscribed")} className="cursor-pointer font-medium text-red-400">Unsubscribed</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="ghost" size="icon" disabled={backendSyncing} onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
                  toast({ title: "Syncing...", description: "Fetching latest messages from the cloud." });
                }}>
                  <RefreshCw className={cn("h-4 w-4", backendSyncing && "animate-spin text-primary")} />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Download className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {([
                      ['replied', 'text-emerald-500', 'Leads That Replied'],
                      ['booked', 'text-blue-500', 'Leads That Booked'],
                      ['no_show', 'text-red-500', 'Booked But No Show'],
                      ['no_reply', 'text-orange-500', 'Cold / No Reply'],
                      ['ghosted', 'text-purple-500', 'Ghosted After Reply'],
                      ['converted', 'text-yellow-500', 'Paid / Converted'],
                    ] as const).map(([cat, color, label]) => (
                      <DropdownMenuItem
                        key={cat}
                        className="font-medium text-sm cursor-pointer"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/bulk/export-category?category=${cat}`, { credentials: 'include' });
                            if (!res.ok) {
                              toast({ title: 'No Leads', description: `No leads in "${label}" category.`, variant: 'default' });
                              return;
                            }
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `leads_${cat}_${Date.now()}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch {
                            toast({ title: 'Export Failed', description: 'Could not export leads.', variant: 'destructive' });
                          }
                        }}
                      >
                        <span className={`${color} mr-2`}>●</span> {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 gap-1.5 text-xs font-medium"
                  onClick={() => setIsCampaignListOpen(true)}
                >
                  <Send className="h-3.5 w-3.5" />
                  Campaign
                </Button>
                <Button
                  variant={showArchived ? "secondary" : hasArchivedLeads ? "outline" : "ghost"}
                  size="icon"
                  className={cn("h-8 w-8", showArchived && "text-primary")}
                  onClick={() => setShowArchived(!showArchived)}
                  title={showArchived ? "Hide Archived" : hasArchivedLeads ? "Show Archived" : "No archived leads"}
                >
                  <Archive className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="relative flex items-center">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                className="pl-9 pr-9 h-10 rounded-xl bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button
                onClick={() => setSearchQuery(prev => {
                  if (prev.startsWith('/') && prev.endsWith('/')) return prev.slice(1, -1);
                  return `/${prev || ''}/`;
                })}
                className={cn(
                  "absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold transition-all",
                  enableRegex ? "bg-primary/20 text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"
                )}
                title={enableRegex ? "Regex mode ON" : "Toggle regex search"}
              >
                .*
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              <Button variant="ghost" size="sm" onClick={() => setFilterChannel("all")} className={cn("h-7 px-4 rounded-full text-[10px] font-bold uppercase tracking-widest shrink-0 transition-all", filterChannel === 'all' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "hover:bg-muted")}>All</Button>
              <Button variant="ghost" size="sm" onClick={() => setFilterChannel("instagram")} className={cn("h-7 px-4 rounded-full text-[10px] font-bold uppercase tracking-widest shrink-0 transition-all", filterChannel === 'instagram' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "hover:bg-muted")}>Instagram</Button>
              <Button variant="ghost" size="sm" onClick={() => setFilterChannel("email")} className={cn("h-7 px-4 rounded-full text-[10px] font-bold uppercase tracking-widest shrink-0 transition-all", filterChannel === 'email' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "hover:bg-muted")}>Email</Button>
            </div>

            {/* Mobile/Desktop Connect Alert */}
            {showDisconnectedAlert && (
              <div className="mx-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                <div className="p-1.5 bg-red-500/20 rounded-full shrink-0">
                  <Plug className="h-3 w-3 text-red-500" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-bold text-foreground">Channels Disconnected</h4>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 mb-2">
                    Connect Email or Instagram to sync replies.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[9px] font-bold uppercase w-full bg-background hover:bg-red-500/5 hover:text-red-500 border-red-500/20"
                    onClick={() => setLocation('/dashboard/integrations')}
                  >
                    Connect Now
                  </Button>
                </div>
              </div>
            )}


            {/* Bulk Action Bar */}
            <AnimatePresence>
              {selectedLeadIds.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center justify-between pb-2"
                >
                  <span className="text-xs font-bold text-primary">{selectedLeadIds.length} Selected</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => handleBulkAction('archive')} title="Archive Selected">
                      <Archive className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleBulkAction('delete')} title="Delete Selected">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setSelectedLeadIds([])}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active Status Display */}
            {filterStatus !== 'all' && (
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Filtering by:</span>
                <Badge variant="secondary" className="text-[10px] px-2 h-5 uppercase">
                  {filterStatus}
                  <X
                    className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setFilterStatus('all'); }}
                  />
                </Badge>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border/5">
            {(!hasLoadedLeadsRef.current || (leadsFetching && allLeads.length === 0) || channelsLoading) && page === 0 ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
              </div>
            ) : filteredLeads.length === 0 && !leadsFetching && hasLoadedLeadsRef.current && !channelsLoading && allLeads.length > 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center h-full min-h-[400px] animate-in fade-in zoom-in duration-700">
                <div className="max-w-xs">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-500/20 to-gray-500/20 border border-slate-500/20 flex items-center justify-center mb-6 mx-auto">
                    <InboxIcon className="h-10 w-10 text-slate-400" />
                  </div>
                  <p className="text-sm font-bold text-foreground/80">
                    {searchQuery ? "No matches found" :
                      filterStatus !== 'all' ? `No ${filterStatus} conversations` :
                        "No conversations yet"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {searchQuery ? "Try different keywords or check spelling" :
                      filterStatus === 'unread' ? "All caught up — no unread messages" :
                      filterStatus === 'opened' ? "No opened conversations yet" :
                      filterStatus === 'archived' ? "No archived conversations" :
                      filterStatus !== 'all' ? "Try a different filter or check back later" :
                        "Start a campaign to see conversations here"}
                  </p>
                </div>
              </div>
            ) : !leadsFetching && hasLoadedLeadsRef.current && !channelsLoading && allLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center h-full min-h-[400px] animate-in fade-in zoom-in duration-700">
                {hasAnyChannel === false ? (
                  <div className="max-w-xs">
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-8 mx-auto relative group">
                      <div className="absolute inset-0 bg-primary/20 blur-xl md:blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                      <Plug className="h-10 w-10 text-primary relative z-10 animate-pulse" />
                      <div className="absolute -top-1 -right-1 h-4 w-4 bg-destructive rounded-full border-2 border-background" />
                    </div>
                    <h3 className="text-lg font-bold tracking-tight mb-2">Connect Sources</h3>
                    <p className="text-sm text-muted-foreground/60 font-medium mb-8 leading-relaxed">
                      Your inbox is ready. Just connect your email or Instagram to start importing and engaging leads in real-time.
                    </p>
                    <Button
                      size="lg"
                      className="rounded-xl font-bold uppercase tracking-wider text-xs h-10 px-10 shadow-md shadow-primary/15 transition-all w-full"
                      onClick={() => setLocation('/dashboard/integrations')}
                    >
                      Connect Sources Now <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="max-w-xs">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-500/20 to-gray-500/20 border border-slate-500/20 flex items-center justify-center mb-6 mx-auto">
                      <InboxIcon className="h-10 w-10 text-slate-400" />
                    </div>
                    <p className="text-sm font-bold text-foreground/80">
                      {searchQuery ? "No matches found" :
                        filterStatus !== 'all' ? `No ${filterStatus} conversations` :
                          "No conversations yet"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {searchQuery ? "Try different keywords or check spelling" :
                        filterStatus === 'unread' ? "All caught up — no unread messages" :
                        filterStatus === 'opened' ? "No opened conversations yet" :
                        filterStatus === 'archived' ? "No archived conversations" :
                        filterStatus !== 'all' ? "Try a different filter or check back later" :
                          allLeads.length > 0 ? "Start a campaign to see conversations here" :
                            "Connect a mailbox to start receiving messages"}
                    </p>
                  </div>
                )}
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-auto overflow-x-auto relative" ref={leadListRef}>
                  <div style={{ height: filteredLeads.length * 90, position: 'relative' }}>
                    {filteredLeads.slice(virtualStart, virtualEnd).map((lead, i) => {
                      const realIdx = virtualStart + i;
                      return (<div
                        key={lead.id}
                        onClick={() => {
                          if (selectedLeadIds.length > 0) {
                            toggleLeadSelection(lead.id);
                          } else {
                            setLocation(`/dashboard/inbox/${lead.id}`);
                          }
                        }}
                        onContextMenu={(e) => handleContextMenu(e, 'inbox', lead)}
                        className={cn(
                          "p-5 cursor-pointer border-b border-border/10 transition-all relative group flex gap-4",
                          leadId === lead.id ? "bg-primary/10" : "hover:bg-muted/30",
                          lead.metadata?.isUnread && "bg-primary/5",
                          selectedLeadIds.includes(lead.id) && "bg-primary/20"
                        )}
                        style={{ position: 'absolute', top: realIdx * 90, left: 0, right: 0 }}
                      >
                        <div className={cn(
                          "absolute left-2 top-1/2 -translate-y-1/2 z-10 transition-all",
                          selectedLeadIds.includes(lead.id) || "opacity-0 group-hover:opacity-100"
                        )}
                          onClick={(e) => toggleLeadSelection(lead.id, e)}
                        >
                          <div className={cn("h-5 w-5 rounded-md border flex items-center justify-center transition-colors", selectedLeadIds.includes(lead.id) ? "bg-primary border-primary" : "bg-background border-border")}>
                            {selectedLeadIds.includes(lead.id) && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>
                        </div>
                        {leadId === lead.id && <motion.div layoutId="activeLead" className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                        <div className={cn("flex gap-3 items-center transition-all", (selectedLeadIds.length > 0 || selectedLeadIds.includes(lead.id)) && "pl-8")}>
                          <Avatar className="h-12 w-12 border-2 border-background shadow-sm transition-transform group-hover:scale-105 shrink-0 rounded-full">
                            <AvatarImage src={lead.avatar} />
                            <AvatarFallback className={cn("font-bold text-sm rounded-full", lead.id === leadId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{lead.name?.[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex justify-between items-start gap-2">
                              <span className="text-sm font-bold truncate text-foreground flex-1 max-w-[120px] md:max-w-[140px] lg:max-w-[200px] xl:max-w-[300px]" title={lead.name}>
                                <HighlightText text={lead.name} query={searchQuery} />
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                {lead.email && <span className="text-[10px] text-muted-foreground/60 truncate max-w-[130px] hidden lg:block" title={lead.email}>{lead.email}</span>}
                                {lead.company && <span className="text-[10px] text-muted-foreground/40 truncate max-w-[80px] hidden xl:block" title={lead.company}>{lead.company}</span>}
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-primary" onClick={(e) => { e.stopPropagation(); setProcessLead(lead); }}>
                                  <Brain className="h-4 w-4" />
                                </Button>
                                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider shrink-0 mt-0.5">
                                  {(() => { const d = lead.lastMessageAt || lead.createdAt; return d ? formatDateShort(d) : ''; })()}
                                </span>
                              </div>
                            </div>
                            <p className={cn("text-xs line-clamp-1 overflow-hidden transition-colors", lead.metadata?.isUnread ? "text-foreground font-bold" : "text-muted-foreground")}>
                              {typingLeadId === lead.id ? (
                                <span className="flex items-center gap-1 text-primary font-bold animate-pulse">Typinng...</span>
                              ) : localDrafts[lead.id] ? (
                                <span className="text-destructive font-bold">Draft: <span className="font-normal text-muted-foreground/80">{localDrafts[lead.id]}</span></span>
                              ) : (
                                <HighlightText text={lead.snippet || "No messages"} query={searchQuery} />
                              )}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge {...({ variant: "outline", className: cn("text-[9px] h-4 px-1 rounded-sm border-0 uppercase font-black tracking-wider", statusStyles[lead.status as keyof typeof statusStyles] || statusStyles.cold) } as any)}>
                                {getLeadStatusDisplay(lead.status)}
                              </Badge>
                              {lead.metadata?.isUnread && (() => { const isOld = new Date().getTime() - new Date(lead.createdAt).getTime() > 24 * 60 * 60 * 1000; return !isOld ? <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : null; })()}
                            </div>
                          </div>
                        </div>
                      </div>);
                    })}
                  </div>
                  {leadsData?.hasMore && (
                    <div className="p-4">
                      <Button variant="outline" className="w-full text-xs font-bold uppercase tracking-widest rounded-xl h-10 border-dashed text-foreground"
                        onClick={() => setPage(p => p + 1)} disabled={leadsLoading}>
                        {leadsLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Load More
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Message Thread Pane */}
        <div className={cn("flex-1 flex flex-col bg-background h-full min-w-0 w-full", !leadId && "hidden md:flex items-center justify-center")}>
          {!leadId ? (
            <div className="text-center space-y-6 max-w-sm px-6">
              <div className="relative mx-auto w-24 h-24">
                <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full animate-pulse" />
                <div className="relative h-24 w-24 rounded-2xl bg-card border border-border/40 flex items-center justify-center shadow-2xl">
                  <InboxIcon className="h-10 w-10 text-primary/40" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground uppercase tracking-tight">Command Center</h2>
                <p className="text-sm text-muted-foreground/60 leading-relaxed">
                  Select a live conversation to view deep lead intelligence, handle objections, or let the AI Agent take full control.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 overflow-hidden h-full">
              <div className="flex-1 flex flex-col h-full min-w-0">
                {/* Thread Header */}
                <div className="h-16 md:h-20 border-b flex items-center px-4 md:px-8 justify-between bg-background shrink-0 z-10">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Back Button for All Device Views */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 -ml-2 text-muted-foreground hover:text-primary transition-colors block"
                      onClick={() => setLocation('/dashboard/inbox')}
                      title="Back to Inbox"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>

                    <Avatar className="h-10 w-10 shrink-0 border-2 border-background shadow-sm rounded-full">
                      <AvatarImage src={activeLead?.avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold rounded-full">{activeLead?.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold line-clamp-2 break-words leading-tight mb-1" title={activeLead?.name}>{activeLead?.name}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{activeLead?.status ? getLeadStatusDisplay(activeLead.status) : ''}</span>
                        <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                        <ChannelIcon className={cn("h-3 w-3 shrink-0", !isChannelConnected(activeLead?.channel) ? "text-destructive" : "text-muted-foreground")} />
                        {!isChannelConnected(activeLead?.channel) && (
                          <span className="text-[9px] font-bold text-destructive uppercase tracking-wide ml-1 hidden sm:inline">Disconnected</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Sheet open={showDetails} onOpenChange={setShowDetails}>
                      <SheetTrigger asChild>
                        <Badge
                          className="bg-gradient-to-r from-yellow-500 to-amber-600 text-white border-none font-bold text-[10px] hidden xl:block px-3 py-1 uppercase tracking-tighter cursor-pointer hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all md:animate-pulse"
                          onClick={() => setShowDetails(true)}
                        >
                          {activeLead?.score || 0}% Engagement Insight
                        </Badge>
                      </SheetTrigger>
                      <SheetContent
                        side="right"
                        className="w-[100vw] sm:w-full sm:max-w-[450px] p-0 bg-background border-l border-border/30 flex flex-col h-full overflow-hidden"
                      >
                        <SheetHeader className="p-6 border-b border-border/30 shrink-0">
                          <SheetTitle className="text-xl font-black text-foreground uppercase tracking-tighter flex items-center gap-3">
                            <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                            Lead Intelligence
                          </SheetTitle>
                        </SheetHeader>

                        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar">
                          <Accordion type="multiple" defaultValue={["metrics", "contact"]} className="w-full space-y-4">
                            {/* Intensity Metrics */}
                            <AccordionItem value="metrics" className="border-none space-y-2">
                              <AccordionTrigger className="hover:no-underline py-0">
                                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Engagement Probability</h4>
                              </AccordionTrigger>
                              <AccordionContent className="pt-2">
                                <div className="p-6 rounded-3xl bg-muted/10 border border-border/30 space-y-4 shadow-inner">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-muted-foreground">Engagement Rank</span>
                                    <span className="text-xs font-black text-foreground text-lg tracking-tighter">
                                      #{leadsData?.leads ?
                                        [...leadsData.leads]
                                          .sort((a, b) => (b.score || 0) - (a.score || 0))
                                          .findIndex(l => l.id === activeLead?.id) + 1
                                        : 0} / {leadsData?.leads?.length || 0}
                                    </span>
                                  </div>
                                  <div className="h-2 w-full bg-muted/30 rounded-full overflow-hidden">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${isNaN(Number(activeLead?.score)) ? 0 : (activeLead?.score || 0)}%` }}
                                      className="h-full bg-primary shadow-[0_0_15px_rgba(var(--primary),0.6)]"
                                    />
                                  </div>
                                  <p className="text-[10px] text-muted-foreground/60 font-medium leading-relaxed italic mt-2">
                                    Probability calculated based on real-time intelligence engagement patterns.
                                  </p>
                                </div>
                              </AccordionContent>
                            </AccordionItem>

                            {/* Contact Info */}
                            <AccordionItem value="contact" className="border-none space-y-2">
                              <AccordionTrigger className="hover:no-underline py-0">
                                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Contact Identity</h4>
                              </AccordionTrigger>
                              <AccordionContent className="pt-2">
                                <div className="grid gap-3">
                                  <div className="p-4 rounded-2xl bg-muted/10 border border-border/30 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                                        <Mail className="w-5 h-5" />
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-0.5">Email</p>
                                        <p className="text-xs font-bold text-foreground truncate max-w-[150px]">{activeLead?.email || 'Not provided'}</p>
                                      </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40" />
                                  </div>
                                  <div className="p-4 rounded-2xl bg-muted/10 border border-border/30 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                        <Phone className="w-5 h-5" />
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-0.5">Phone</p>
                                        <p className="text-xs font-bold text-foreground leading-none">{activeLead?.phone || 'Private'}</p>
                                      </div>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40" />
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>

                            {/* Social Graph */}
                            <AccordionItem value="social" className="border-none space-y-2">
                              <div className="flex items-center justify-between">
                                <AccordionTrigger className="hover:no-underline py-0">
                                  <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Social Insight</h4>
                                </AccordionTrigger>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] font-black uppercase"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (metadataEditMode) {
                                      handleSaveMetadata();
                                    } else {
                                      setEditedMetadata({
                                        instagram: activeLead?.metadata?.socialLinks?.instagram || activeLead?.socialLinks?.instagram || "",
                                        facebook: activeLead?.metadata?.socialLinks?.facebook || activeLead?.socialLinks?.facebook || "",
                                        googleMaps: activeLead?.metadata?.socialLinks?.googleMaps || "",
                                        reviews: activeLead?.metadata?.socialLinks?.reviews || ""
                                      });
                                      setMetadataEditMode(true);
                                    }
                                  }}
                                  disabled={updateLead.isPending}
                                >
                                  {metadataEditMode ? (updateLead.isPending ? "Saving..." : "Save") : "Edit"}
                                </Button>
                              </div>
                              <AccordionContent className="pt-2">
                                {metadataEditMode ? (
                                  <div className="space-y-3 p-4 bg-muted/10 rounded-2xl border border-border/30">
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Instagram URL</label>
                                      <Input
                                        className="h-8 text-xs bg-background"
                                        value={editedMetadata.instagram}
                                        onChange={(e) => setEditedMetadata({ ...editedMetadata, instagram: e.target.value })}
                                        placeholder="https://instagram.com/..."
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Facebook URL</label>
                                      <Input
                                        className="h-8 text-xs bg-background"
                                        value={editedMetadata.facebook}
                                        onChange={(e) => setEditedMetadata({ ...editedMetadata, facebook: e.target.value })}
                                        placeholder="https://facebook.com/..."
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Google Maps URL</label>
                                      <Input
                                        className="h-8 text-xs bg-background"
                                        value={editedMetadata.googleMaps}
                                        onChange={(e) => setEditedMetadata({ ...editedMetadata, googleMaps: e.target.value })}
                                        placeholder="https://maps.google.com/..."
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Reviews Page URL</label>
                                      <Input
                                        className="h-8 text-xs bg-background"
                                        value={editedMetadata.reviews}
                                        onChange={(e) => setEditedMetadata({ ...editedMetadata, reviews: e.target.value })}
                                        placeholder="https://..."
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-2 gap-3">
                                    {[
                                      { name: 'Instagram', url: activeLead?.metadata?.socialLinks?.instagram || activeLead?.socialLinks?.instagram, icon: Instagram },
                                      { name: 'Facebook', url: activeLead?.metadata?.socialLinks?.facebook || activeLead?.socialLinks?.facebook, icon: Facebook },
                                      { name: 'Google Maps', url: activeLead?.metadata?.socialLinks?.googleMaps, icon: MapPin },
                                      { name: 'Reviews', url: activeLead?.metadata?.socialLinks?.reviews, icon: Star },
                                      { name: 'LinkedIn', url: activeLead?.linkedinProfileUrl || activeLead?.socialLinks?.linkedin, icon: ExternalLink },
                                      { name: 'Twitter', url: activeLead?.socialLinks?.twitter, icon: ExternalLink },
                                      { name: 'Website', url: activeLead?.website || activeLead?.socialLinks?.website, icon: ExternalLink }
                                    ].map((platform) => (
                                      platform.url ? (
                                        <Button
                                          key={platform.name}
                                          variant="outline"
                                          className="h-12 border-border/30 bg-muted/10 hover:bg-muted/20 rounded-2xl justify-start px-3"
                                          onClick={() => platform.url && window.open(platform.url.startsWith('http') ? platform.url : `https://${platform.url}`, '_blank', 'noopener,noreferrer')}
                                        >
                                          <platform.icon className={`w-3.5 h-3.5 mr-2 text-primary`} />
                                          <span className={`text-[10px] font-bold text-foreground`}>{platform.name}</span>
                                        </Button>
                                      ) : null
                                    ))}
                                    {/* Show placeholder if no links exist */}
                                    {![
                                      activeLead?.metadata?.socialLinks?.instagram, activeLead?.socialLinks?.instagram,
                                      activeLead?.metadata?.socialLinks?.facebook, activeLead?.socialLinks?.facebook,
                                      activeLead?.metadata?.socialLinks?.googleMaps,
                                      activeLead?.metadata?.socialLinks?.reviews,
                                      activeLead?.linkedinProfileUrl, activeLead?.socialLinks?.linkedin,
                                      activeLead?.socialLinks?.twitter,
                                      activeLead?.website, activeLead?.socialLinks?.website
                                    ].some(Boolean) && (
                                        <div className="col-span-2 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 py-4">
                                          No social links added
                                        </div>
                                      )}
                                  </div>
                                )}
                              </AccordionContent>
                            </AccordionItem>

                            {/* Historical Velocity */}
                            <AccordionItem value="history" className="border-none space-y-2">
                              <AccordionTrigger className="hover:no-underline py-0">
                                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">History</h4>
                              </AccordionTrigger>
                              <AccordionContent className="pt-2">
                                <div className="p-4 rounded-2xl bg-muted/20 border border-border/30 space-y-3">
                                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                                    <span className="text-muted-foreground flex items-center gap-2"><Clock className="h-3.5 w-3.5" /> Detected</span>
                                    <span className="text-foreground/70">{activeLead?.createdAt ? formatDateShort(activeLead.createdAt) : "Unknown"}</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                                    <span className="text-muted-foreground flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5" /> Threads</span>
                                    <span className="text-foreground/70">{messagesData?.messages?.length || 0} messages</span>
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>


                          </Accordion>
                        </div>

                        <div className="p-6 border-t border-border/30 bg-muted/10 shrink-0 space-y-3">
                          <Button
                            className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase text-[11px] tracking-widest rounded-2xl shadow-xl shadow-primary/20"
                            onClick={() => setShowIntelligence(true)}
                          >
                            <Zap className="w-5 h-5 mr-3" />
                            Launch Deep Intelligence
                          </Button>
                          <div className="grid grid-cols-2 gap-3">
                            <Button
                              variant="outline"
                              className="h-12 border-border/30 bg-transparent hover:bg-muted/20 text-muted-foreground font-black uppercase text-[9px] tracking-tighter rounded-xl"
                              onClick={() => setLocation(`/dashboard/leads/${leadId}`)}
                            >
                              <User className="w-4 h-4 mr-2" />
                              Full Profile
                            </Button>
                            <Button
                              variant="outline"
                              className="h-12 border-border/30 bg-transparent hover:bg-muted/20 text-muted-foreground font-black uppercase text-[9px] tracking-tighter rounded-xl"
                              onClick={() => {
                                setIsCampaignModalOpen(true);
                              }}
                            >
                              <Mail className="w-4 h-4 mr-2" />
                              Start Campaign
                            </Button>
                          </div>
                        </div>
                      </SheetContent>
                    </Sheet>

                    {/* Autonomous Toggle */}
                    {(() => {
                      const isGlobalAiEngineOn = user?.config?.autonomousMode !== false;
                      const isEffectivelyPaused = !isGlobalAiEngineOn || activeLead?.aiPaused;
                      
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-9 rounded-xl font-bold text-[10px] px-4 transition-all shadow-sm border",
                                !isEffectivelyPaused
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                                  : "bg-muted text-muted-foreground border-border/50 hover:bg-muted/80"
                              )}
                              onClick={() => {
                                if (!isGlobalAiEngineOn) {
                                  toast({ title: "AI Engine is OFF", description: "Turn on the Global AI Engine in the sidebar to enable autonomous mode.", variant: "destructive" });
                                  return;
                                }
                                if (activeLead) {
                                  toggleAi.mutate({ id: leadId!, paused: !activeLead.aiPaused });
                                }
                              }}
                            >
                              <div className={cn("w-2 h-2 rounded-full mr-2", !isEffectivelyPaused ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground")} />
                              <span className="hidden sm:inline">
                                {!isGlobalAiEngineOn 
                                  ? "SYSTEM PAUSED" 
                                  : (!activeLead?.aiPaused ? "AUTONOMOUS MODE: ON" : "AUTONOMOUS MODE: OFF")}
                              </span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent 
                            side="bottom" 
                            className="bg-black/90 text-white border-white/10 text-[10px] py-2 px-3 rounded-lg shadow-2xl"
                          >
                            {!isGlobalAiEngineOn 
                              ? "Global AI Engine is disabled. Individual lead automation is paused."
                              : (!activeLead?.aiPaused 
                                ? "AI is fully autonomous for this lead. It will draft and respond automatically." 
                                : "AI automation is paused for this lead. Toggle to re-enable autonomous processing.")
                            }
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}

                    {!showDetails && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-primary hidden lg:flex hover:bg-primary/10 transition-colors"
                        onClick={() => setShowDetails(true)}
                      >
                        <User className="h-5 w-5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-primary lg:hidden hover:bg-primary/10 transition-colors"
                      onClick={() => setShowDetails(true)}
                    >
                      <User className="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                {/* Quick Reply Header */}
                {leadId && isChannelConnected(activeLead?.channel) && (
                  <div className="border-b border-border/30 bg-gradient-to-r from-amber-500/5 via-background to-amber-500/5 px-4 md:px-8 py-2 shrink-0">
                    <div className="flex items-center gap-2 max-w-5xl mx-auto w-full">
                      <div className="flex-1 relative">
                        <input
                          value={replyMessage}
                          onChange={e => {
                            setReplyMessage(e.target.value);
                            if (leadId) {
                              if (e.target.value.trim()) {
                                localStorage.setItem(`draft_${leadId}`, e.target.value);
                              } else {
                                localStorage.removeItem(`draft_${leadId}`);
                              }
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitReply();
                            }
                          }}
                          placeholder="Quick reply..."
                          className="w-full h-9 bg-muted/30 border border-border/40 rounded-xl px-3 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all placeholder:text-muted-foreground/40"
                        />
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={handleAI}
                        disabled={isPolishing || isGenerating}
                        className="h-8 w-8 rounded-lg shrink-0"
                        title={replyMessage.trim() ? "Polish with AI" : "Generate AI Reply"}
                      >
                        {isPolishing || isGenerating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : replyMessage.trim() ? (
                          <Wand2 className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        )}
                      </Button>
                      <Button
                        onClick={submitReply}
                        disabled={!replyMessage.trim() || sendMutation.isPending}
                        size="icon"
                        className="h-8 w-8 rounded-xl shrink-0 shadow-sm"
                      >
                        {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 min-h-0 scroll-smooth flex flex-col bg-muted/5 scrollbar-hide">
                  {(messagesLoading || messagesFetching) && !messagesData?.messages?.length ? (
                    <div className="space-y-6">
                      <div className="flex justify-start"><Skeleton className="h-16 w-64 rounded-2xl rounded-tl-none" /></div>
                      <div className="flex justify-end"><Skeleton className="h-16 w-64 rounded-2xl rounded-tr-none" /></div>
                      <div className="flex justify-start"><Skeleton className="h-12 w-48 rounded-2xl rounded-tl-none" /></div>
                    </div>
                  ) : [...(messagesData?.messages || [])].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((msg: any, _idx: number) => {
                    const prevMsg = _idx > 0 ? [...(messagesData?.messages || [])].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[_idx - 1] : null;
                    const showHeader = !prevMsg || prevMsg.subject !== msg.subject;
                    return (
                    <div key={msg.id} className="flex flex-col w-full">
                      {msg.subject && showHeader && (
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 px-1 mb-2 mt-2">
                          {msg.subject.replace(/^Re:\s*/i, '').replace(/\{\{[^}]+\}\}/g, '')}
                        </div>
                      )}
                      <div className={cn("flex w-full min-w-0", msg.direction === 'inbound' ? "justify-start" : "justify-end")}>
                      <div className={cn(
                        "max-w-[90%] md:max-w-[75%] lg:max-w-[65%] p-4 rounded-2xl text-sm shadow-sm relative group transition-all hover:shadow-md min-w-0",
                        msg.direction === 'inbound'
                          ? "bg-card text-card-foreground rounded-tl-none border border-border/50 shadow-sm"
                          : "bg-primary text-primary-foreground rounded-tr-none shadow-md shadow-primary/20"
                      )}>
                          <div className="whitespace-pre-wrap break-words break-all leading-relaxed overflow-hidden">
                            {(() => {
                              let displayText = msg.body || msg.content || '';
                              // Strip unresolved variables {{...}}
                              displayText = displayText.replace(/\{\{[^}]+\}\}/g, '');
                              // Strip raw HTML if detected
                              const isHtmlContent = isHtml(displayText);
                              if (isHtmlContent) {
                                return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(displayText, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div'] }) }} className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1" />;
                              }
                              return <HighlightText text={displayText} query={searchQuery} />;
                            })()}
                          </div>
                        {msg.metadata?.disclaimer && (
                          <div className="mt-3 pt-3 border-t border-current/10 text-[10px] opacity-60 italic font-medium">
                            {msg.metadata.disclaimer}
                          </div>
                        )}
                        <div className="text-[10px] mt-2 opacity-50 flex items-center gap-1.5 justify-end font-medium">
                          {msg.direction === 'outbound' && (
                            <div className="flex items-center gap-1 mr-auto">
                              {msg.clickedAt ? (
                                <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-emerald-500/20 text-emerald-200 border-none shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                                  <ExternalLink className="h-2 w-2 mr-1" /> CLICKED
                                </Badge>
                              ) : msg.openedAt ? (
                                <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-sky-500/20 text-sky-100 border-none shadow-[0_0_8px_rgba(14,165,233,0.3)]">
                                  <Activity className="h-2 w-2 mr-1" /> OPENED
                                </Badge>
                              ) : (
                                <span className="opacity-40">Delivered</span>
                              )}
                            </div>
                          )}
                          {msg.metadata?.aiGenerated && <Sparkles className="h-2.5 w-2.5" />}
                          {formatTimeOnly(msg.createdAt)}
                          {msg.direction === 'outbound' && (
                            <div className="flex ml-1">
                              <Check className={cn("h-3 w-3", msg.openedAt ? "text-primary-foreground" : "opacity-40")} />
                              {msg.openedAt && <Check className="h-3 w-3 -ml-2 text-primary-foreground" />}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    </div>
                  )})}
                  {isGenerating && typedText && (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] md:max-w-[70%] p-4 rounded-2xl text-sm shadow-lg bg-primary/10 border border-primary/20 rounded-tr-none">
                        <div className="whitespace-pre-wrap break-words italic text-primary/80">{typedText}</div>
                        <div className="flex items-center gap-2 mt-3">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="text-[10px] text-primary/70 font-bold uppercase tracking-widest">Optimizing response...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} className="h-4 shrink-0" />
                </div>

                {/* Reply Input */}
                {!isChannelConnected(activeLead?.channel) ? (
                  <div className="p-4 md:p-6 border-t bg-background shrink-0 shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.05)] sticky bottom-0 z-20 w-full mb-[env(safe-area-inset-bottom)]">
                    <div className="max-w-5xl mx-auto flex flex-col items-center justify-center p-6 bg-destructive/5 border border-destructive/20 rounded-2xl text-center space-y-3">
                      <div className="p-3 bg-destructive/10 rounded-full">
                        <Plug className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-destructive uppercase tracking-wide">Channel Disconnected</h4>
                        <p className="text-xs text-muted-foreground mt-1">Connect your {activeLead?.channel} account to reply to this lead.</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => setLocation('/dashboard/integrations')}
                      >
                        Connect {activeLead?.channel === 'instagram' ? 'Instagram' : 'Email'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 md:p-6 border-t bg-background shrink-0 shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.05)] sticky bottom-0 z-20 w-full mb-[env(safe-area-inset-bottom)]">
                    <div className="flex gap-2 md:gap-3 items-end max-w-5xl mx-auto w-full">
                      <div className="flex-1 relative group bg-white/50 dark:bg-black/20 rounded-2xl border border-border/40 focus-within:border-amber-500/50 focus-within:ring-4 focus-within:ring-amber-500/10 transition-all">
                        {/* Tab Headers */}
                        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/30 bg-muted/20 rounded-t-2xl justify-between">
                          <button onClick={() => setActiveReplyTab('text')} className={cn("text-[10px] font-bold tracking-wider uppercase transition-colors flex items-center gap-1", activeReplyTab === 'text' ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                            <MessageSquare className="w-3 h-3" /> Text
                          </button>
                          
                          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full scrollbar-hide pr-1 py-0.5">
                             <Tags className="w-3 h-3 text-muted-foreground shrink-0" />
                             {allTags.slice(0, 5).map(tag => (
                               <button
                                 key={tag.value}
                                 onClick={() => insertTag(tag.value)}
                                 className="text-[8px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-full bg-primary/5 hover:bg-primary/15 border border-primary/10 text-primary transition-all shrink-0"
                               >
                                 {tag.label}
                               </button>
                             ))}
                          </div>
                        </div>
                        
                        {/* Tab Content */}
                        <Textarea
                          value={replyMessage}
                          onChange={e => {
                            const newText = e.target.value;
                            setReplyMessage(newText);
                            if (leadId) {
                              if (newText.trim()) {
                                localStorage.setItem(`draft_${leadId}`, newText);
                                setLocalDrafts(prev => ({ ...prev, [leadId]: newText }));
                              } else {
                                localStorage.removeItem(`draft_${leadId}`);
                                setLocalDrafts(prev => {
                                  const next = { ...prev };
                                  delete next[leadId];
                                  return next;
                                });
                              }
                            }
                            // Auto-grow logic
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitReply();
                            }
                          }}
                          placeholder="Compose a response..."
                          className="w-full bg-muted/30 border-none rounded-b-2xl p-4 pr-24 text-sm focus:ring-0 min-h-[56px] max-h-40 resize-none transition-all overflow-y-auto"
                        />
                        <div className="absolute right-3 bottom-2 flex gap-1.5 z-10">
                          <Button
                            size="icon"
                            onClick={handleAI}
                            disabled={isPolishing || isGenerating}
                            className={cn(
                              "h-7 w-7 rounded-lg transition-all",
                              replyMessage.trim()
                                ? "hover:bg-primary/10 text-primary"
                                : "bg-gradient-to-br from-[#FFD700] via-[#FDB931] to-[#D4AF37] text-black shadow-lg shadow-amber-500/20 hover:scale-105 active:scale-95 border border-amber-400/50 group/ai"
                            )}
                            title={replyMessage.trim() ? "Polish with AI" : "Generate AI Reply"}
                          >
                            {isPolishing || isGenerating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : replyMessage.trim() ? (
                              <Wand2 className="h-3.5 w-3.5" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 fill-black/20" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <Button
                        onClick={submitReply}
                        disabled={!replyMessage.trim() || sendMutation.isPending}
                        className="rounded-2xl h-12 w-12 p-0 shadow-xl shadow-primary/20 shrink-0 transition-transform active:scale-95"
                      >
                        {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="max-w-5xl mx-auto mt-2 px-1">
                      {grammarErrors.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                          {grammarErrors.slice(0, 3).map((err, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                const newText = replyMessage.replace(err.original, err.suggestion);
                                setReplyMessage(newText);
                                setGrammarErrors(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-[10px] text-red-600 font-bold hover:bg-red-500/20 transition-all group"
                            >
                              <AlertCircle className="w-3 h-3" />
                              <span className="line-through opacity-50">{err.original}</span>
                              <ChevronRight className="w-2.5 h-2.5 opacity-30" />
                              <span className="text-emerald-600">{err.suggestion}</span>
                              <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">Apply</span>
                            </button>
                          ))}
                          {grammarErrors.length > 3 && (
                            <span className="text-[10px] text-muted-foreground self-center italic font-medium">
                              +{grammarErrors.length - 3} more corrections suggested
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-center text-[10px] text-muted-foreground/40 font-medium">Shift + Enter for new line. AI suggestions enabled.</p>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {
        activeLead && (
          <LeadIntelligenceModal
            isOpen={showIntelligence}
            onOpenChange={setShowIntelligence}
            lead={activeLead}
          />
        )
      }
      <CustomContextMenu
        config={contextConfig}
        onClose={closeMenu}
        onAction={handleMenuAction}
      />
      <CampaignListModal
        isOpen={isCampaignListOpen}
        onClose={() => setIsCampaignListOpen(false)}
        onNewCampaign={() => setIsCampaignModalOpen(true)}
      />
      <UnifiedCampaignWizard
        isOpen={isCampaignModalOpen}
        onClose={() => setIsCampaignModalOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        }}
        initialLeads={selectedLeadIds.length > 0 ? selectedLeadIds : []}
      />
      <LeadProcessModal
        isOpen={!!processLead}
        onClose={() => setProcessLead(null)}
        lead={processLead}
        messages={messagesData?.messages || []}
      />


    </PageWrapper>
  );
}
