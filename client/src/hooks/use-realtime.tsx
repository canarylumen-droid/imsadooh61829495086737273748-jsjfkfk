import { useEffect, useState, useRef, createContext, useContext, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useToast } from '@/hooks/use-toast';

// Debounce helper — coalesces rapid calls within `ms` window
function createDebounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  return debounced as unknown as T;
}

// Register service worker for PWA
const registerServiceWorker = async () => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }
};

// Show push notification (works even when tab is closed)
const showPushNotification = async (title: string, options: any) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification(title, {
      icon: '/logo.png',
      badge: '/logo.png',
      vibrate: [200, 100, 200],
      ...options
    });
  }
};



const playSentSound = () => {
  try {
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.4; // Slightly quieter for sent sound
    audio.play().catch(() => {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    });
  } catch (err) {
    console.warn('[Realtime] Sent sound playback failed:', err);
  }
};

// Format relative time
const getRelativeTime = (timestamp: string | Date): string => {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return 'Just now';
  if (diffSeconds < 120) return '1 min ago';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} mins ago`;
  if (diffSeconds < 7200) return '1 hour ago';
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} hours ago`;
  if (diffSeconds < 172800) return '1 day ago';
  return `${Math.floor(diffSeconds / 86400)} days ago`;
};

interface RealtimeContextType {
  socket: Socket | null;
  isConnected: boolean;
  isSyncing: boolean;
  notificationPermission: NotificationPermission;
  requestPermission: () => Promise<void>;
}

const RealtimeContext = createContext<RealtimeContextType>({
  socket: null,
  isConnected: false,
  isSyncing: false,
  notificationPermission: 'default',
  requestPermission: async () => { }
});

export function useRealtime() {
  return useContext(RealtimeContext);
}

interface RealtimeProviderProps {
  children: ReactNode;
  userId?: string;
}

export function RealtimeProvider({ children, userId }: RealtimeProviderProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const lastNotificationTime = useRef<number>(0);
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isSyncing, setIsSyncing] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  // Debounced query invalidators — prevent refetch storms at 50 emails/sec
  const debouncedInvalidateStats = useRef(createDebounce(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats/previous'] });
    queryClient.invalidateQueries({ queryKey: ['/api/email/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/stats/inbox-placement'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warmup/status'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/warmup-status'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/analytics/full'] });
  }, 300)).current;

  const debouncedInvalidateLeads = useRef(createDebounce(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
    queryClient.invalidateQueries({ queryKey: ['prospects'] });
    queryClient.invalidateQueries({ queryKey: ['/api/prospecting/leads'] });
    queryClient.invalidateQueries({ queryKey: ['/api/leads/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/activity'] });
  }, 300)).current;

  const debouncedInvalidateMessages = useRef(createDebounce(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/activity'] });
  }, 300)).current;

  const debouncedInvalidateWarmup = useRef(createDebounce(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard/warmup-status'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warmup/activity'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warmup/status'] });
  }, 300)).current;

  // Computed for backward compatibility
  const isConnected = connectionStatus === 'connected';

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === 'granted') {
      // Unlock audio context with a silent sound
      const audio = new Audio('/sounds/notification.mp3');
      audio.volume = 0.01;
      audio.play().catch(() => console.warn('[Realtime] Audio unlock failed'));

      toast({
        title: "Notifications Enabled",
        description: "You'll now receive real-time alerts with sound.",
      });
    }
  };

  useEffect(() => {
    // Register service worker on mount
    registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!userId) { console.warn('[Realtime] No userId — socket not connecting'); return; }

    // Connect to Socket.IO server
    // Use relative path for production compatibility or configured URL
    const socketInstance = io(undefined, {
      path: '/socket.io',
      query: { userId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.25,
      timeout: 10000,
      ackTimeout: 5000,
      transports: ['websocket', 'polling'],
      upgrade: true,
      forceNew: false,
    });

    socketRef.current = socketInstance;

    socketInstance.on('connect', () => {
      setSocket(socketInstance);
      setConnectionStatus('connected');
      socketInstance.emit('client:ready', { userId, timestamp: Date.now() });
    });

    socketInstance.on('reconnect', () => {
      // On reconnect, invalidate ALL queries to get fresh data
      queryClient.invalidateQueries();
    });

    socketInstance.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socketInstance.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setConnectionStatus('disconnected');
    });

    const heartbeat = window.setInterval(() => {
      if (socketInstance.connected) {
        socketInstance.emit('client:heartbeat', { userId, timestamp: Date.now() });
      }
    }, 15_000);

    // SYNC STATUS
    let syncTimeout: NodeJS.Timeout | null = null;
    socketInstance.on('sync_status', (payload: any) => {
      setIsSyncing(!!payload.syncing);
      
      if (payload.syncing) {
        if (syncTimeout) clearTimeout(syncTimeout);
        // Safety timeout: 60 seconds max per sync pulse
        syncTimeout = setTimeout(() => setIsSyncing(false), 60000);
      } else {
        if (syncTimeout) clearTimeout(syncTimeout);
      }

      if (payload?.event === 'completed' && payload.count > 0) {
        queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      }
    });

    // LEADS UPDATES
    socketInstance.on('leads_updated', (payload: any) => {
      debouncedInvalidateLeads();

      // Handle INSERT notifications
      if (payload?.event === 'INSERT' && payload.lead && payload.type !== 'bulk_import') {
        toast({
          title: '🎯 New Lead Captured',
          description: `${payload.lead.name} from ${payload.lead.channel}`,
        });
        showPushNotification('🎯 New Lead Captured', {
          body: `${payload.lead.name} from ${payload.lead.channel}`,
          tag: 'new-lead',
          data: { url: '/dashboard/inbox' }
        });
      }

      // Handle UPDATE status changes
      if (payload?.event === 'UPDATE' && payload.lead?.status === 'converted') {
        toast({
          title: '🎉 Conversion!',
          description: `${payload.lead.name} converted to customer`,
        });
        showPushNotification('🎉 Conversion!', {
          body: `${payload.lead.name} converted to customer`,
          tag: 'conversion',
          requireInteraction: true,
          data: { url: '/dashboard/deals' }
        });
      }
    });

    // PROSPECTING EVENTS
    socketInstance.on('PROSPECTING_LOG', (payload: any) => {
      // Let individual pages handle logs via custom event or status
    });

    socketInstance.on('PROSPECT_FOUND', () => {
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/prospecting/leads'] });
    });

    socketInstance.on('PROSPECT_UPDATED', () => {
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/prospecting/leads'] });
    });

    // MESSAGES UPDATES
    socketInstance.on('messages_updated', (payload: any) => {
      debouncedInvalidateMessages();
      // Invalidate specific lead conversation if needed
      if (payload?.message?.leadId) {
        queryClient.invalidateQueries({ queryKey: ["/api/messages", payload.message.leadId] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/activity'] });

      // Notification for inbound messages
      if (payload?.message?.direction === 'inbound') {
        toast({
          title: '💬 New Message',
          description: 'You have a new message from a lead',
        });
        showPushNotification('💬 New Message', {
          body: 'You have a new message from a lead',
          tag: 'new-message',
          data: { url: '/dashboard/conversations' }
        });
      }
    });

    // NOTIFICATIONS UPDATES
    // Backend emits 'notification' event when creating rows or updating status
    socketInstance.on('notification', (payload: any) => {
      // Invalidate notifications queries
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });

      // If it's just a status update (read/unread), don't play sound or show toast
      if (payload.type === 'update') {
        return;
      }

      // Sound and debouncing now handled centrally by NotificationSound component
      // We only handle toast and push notification here

      const relativeTime = getRelativeTime(payload.created_at || new Date());
      toast({
        title: payload.title,
        description: `${payload.message} • ${relativeTime}`,
        variant: payload.type === 'billing_issue' ? 'destructive' : 'default',
      });

      showPushNotification(payload.title, {
        body: payload.message,
        tag: `notif-${payload.id || Date.now()}`,
        data: { url: payload.metadata?.url || '/dashboard/notifications' }
      });
    });

    // NEW MAIL — instant inbox refresh
    socketInstance.on('new_mail', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/analytics/full'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/inbox-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/seed-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/domain-reputation'] });
      if (payload?.subject) {
        toast({ title: '📧 New Email', description: payload.subject });
      }
    });

    // SPAM DETECTED — immediate alert + analytics refresh
    socketInstance.on('spam_detected', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/stats/inbox-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/seed-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/domain-reputation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/analytics/full'] });
      toast({
        title: '⚠️ Spam Detected',
        description: payload?.message || 'Email detected in spam folder',
        variant: 'destructive',
      });
      showPushNotification('⚠️ Spam Detected', {
        body: payload?.message || 'Email detected in spam folder',
        tag: 'spam-detected',
        data: { url: '/dashboard/deliverability' }
      });
    });

    // MAILBOX STATUS — reputation and health refresh
    socketInstance.on('mailbox_status', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-email/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/domain-reputation'] });
    });

    // INTEGRATION REPUTATION UPDATED — per-mailbox reputation live
    socketInstance.on('integration_reputation_updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/stats/domain-reputation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/inbox-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/seed-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/custom-email/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    });

    socketInstance.on('deliverability_updated', (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/stats/inbox-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/seed-placement'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/domain-reputation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });

      if (data?.action === 'pause') {
        toast({
          title: 'Deliverability Alert',
          description: `Campaign paused — inbox rate dropped to ${Math.round((data.inboxRate || 0) * 100)}%`,
          variant: 'destructive',
        });
      } else if (data?.action === 'warn') {
        toast({
          title: 'Deliverability Warning',
          description: `Inbox rate at ${Math.round((data.inboxRate || 0) * 100)}% — monitoring closely`,
        });
      } else if (data?.type === 'seed_placement') {
        toast({
          title: 'Seed Placement Check',
          description: `Seed email found in ${data.folder || 'unknown'} folder`,
        });
      }
    });

    // CALENDAR UPDATES
    socketInstance.on('calendar_updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/oauth/google-calendar/events'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/ai-logs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/slots'] });

      if (payload?.event === 'INSERT' && payload.eventData?.is_ai_booked) {
        toast({
          title: '📅 Meeting Booked',
          description: `AI scheduled: ${payload.eventData.title}`,
        });
        showPushNotification('📅 Meeting Booked', {
          body: `AI scheduled: ${payload.eventData.title}`,
          tag: 'meeting-booked',
          requireInteraction: true,
          data: { url: '/dashboard/calendar' }
        });
      }
    });

    // DEALS UPDATES
    socketInstance.on('deals_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    });

    // SETTINGS/USER UPDATES
    socketInstance.on('settings_updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/custom-email/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/channels/all'] });
      // Refresh inbox leads when a mailbox is connected/disconnected
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      // Emit a custom DOM event so individual settings pages can react
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settings_updated', { detail: payload }));
      }
    });

    socketInstance.on('insights_updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });

      if (payload?.isNew) {
        toast({
          title: '🤖 New AI Insight',
          description: 'A new strategic insight is ready for review.',
        });
      }
    });

    socketInstance.on('activity_updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/activity'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/ai-actions'] }); // Critical for SDR loop visibility
      
      // If activity involves a specific lead (like tracking events), refresh that lead
      if (payload.leadId) {
        queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
        queryClient.invalidateQueries({ queryKey: ['/api/leads/' + payload.leadId] }); // Specific lead details
        queryClient.invalidateQueries({ queryKey: ["/api/messages", payload.leadId] });
      } else {
        // Generic activities (like external deletions) should also refresh high-level data
        queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      }

      if (payload.type === 'email_sent') {
        playSentSound();
      } else if (payload.type === 'email_received' || payload.type === 'message_received') {
        // Sound handled by NotificationSound
      } else if (payload.type === 'email_deleted_externally') {
        // Refresh all relevant views for consistency
        queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      }
    });

    // STATS UPDATES (instant KPI refresh across all pages)
    socketInstance.on('stats_updated', () => {
      debouncedInvalidateStats();
    });

    // CAMPAIGN UPDATES
    socketInstance.on('campaigns_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['/api/outreach/campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['/api/prospecting/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    });

    socketInstance.on('campaign_stats_updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/outreach/campaigns'] });
      if (payload?.campaignId) {
        queryClient.invalidateQueries({ queryKey: [`/api/outreach/campaigns/${payload.campaignId}/progress`] });
        queryClient.invalidateQueries({ queryKey: [`/api/outreach/campaigns/${payload.campaignId}/stats`] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
    });

    // WARMUP UPDATES
    socketInstance.on('warmup_update', () => {
      debouncedInvalidateStats();
      debouncedInvalidateWarmup();
    });

    // ENGINE ALERTS (SAFETY INTERLOCK)
    socketInstance.on('engine_alert', (payload: any) => {
      console.warn('Engine Alert:', payload);
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });

      toast({
        title: payload.title || 'Engine Alert',
        description: payload.message,
        variant: payload.severity === 'critical' ? 'destructive' : 'default',
        duration: 10000, // Show for longer as it's critical safety info
      });

      showPushNotification(payload.title || 'Engine Alert', {
        body: payload.message,
        tag: 'engine-alert',
        requireInteraction: true,
        data: { url: '/dashboard/integrations' }
      });
    });

    // DESKTOP/PUSH NOTIFICATIONS (Manual)
    socketInstance.on('desktop_notification', (payload: any) => {
      const { title, message, url, tag } = payload;

      toast({
        title,
        description: message,
      });

      showPushNotification(title, {
        body: message,
        tag: tag || 'general',
        data: { url: url || '/dashboard' }
      });
    });

    // FORCE DISCONNECT/LOGOUT
    socketInstance.on('TERMINATE_SESSION', () => {
      console.warn('Session terminated by server');
      localStorage.removeItem('userId');
      localStorage.removeItem('user');
      window.location.href = '/auth';
    });

    return () => {
      window.clearInterval(heartbeat);
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, [userId, queryClient, toast]);

  return (
    <RealtimeContext.Provider value={{ socket, isConnected, isSyncing, notificationPermission, requestPermission }}>
      {children}
    </RealtimeContext.Provider>
  );
}
