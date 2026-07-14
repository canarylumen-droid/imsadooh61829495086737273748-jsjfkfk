import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Activity, Mail, AlertCircle } from 'lucide-react';

interface MetricsData {
  deliverabilityScore: number;
  bounceRate: number;
  spamRate: number;
  activeMailboxes: number;
  dailyVolume: number;
  trends?: {
    deliverability: number; // percentage change
    bounceRate: number;
    spamRate: number;
    volume: number;
  };
}

interface MetricsGridProps {
  data: MetricsData;
  loading?: boolean;
  className?: string;
}

export function MetricsGrid({ data, loading = false, className }: MetricsGridProps) {
  const [flashStates, setFlashStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!loading) {
      // Flash effect when data updates
      const keys = ['deliverability', 'bounce', 'spam', 'mailboxes', 'volume'];
      keys.forEach(key => {
        setFlashStates(prev => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setFlashStates(prev => ({ ...prev, [key]: false }));
        }, 500);
      });
    }
  }, [data, loading]);

  const MetricCard = ({ 
    label, 
    value, 
    trend, 
    icon: Icon, 
    color, 
    flashKey 
  }: { 
    label: string; 
    value: string | number; 
    trend?: number; 
    icon: any; 
    color: string;
    flashKey: string;
  }) => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card/50 backdrop-blur-sm p-4 transition-all duration-300",
        flashStates[flashKey] && "bg-primary/5 border-primary/30",
        "hover:border-border/80 hover:bg-card/80"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Icon className={cn("h-4 w-4 shrink-0", color)} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {label}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={cn(
              "text-2xl font-black tabular-nums tracking-tight",
              color
            )}>
              {value}
            </span>
            {trend !== undefined && (
              <div className={cn(
                "flex items-center gap-1 text-[9px] font-bold",
                trend > 0 ? "text-emerald-500" : trend < 0 ? "text-red-500" : "text-muted-foreground"
              )}>
                {trend > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : trend < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : null}
                <span>{Math.abs(trend).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );

  const getDeliverabilityColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-amber-500';
    return 'text-red-500';
  };

  const getRateColor = (rate: number) => {
    if (rate <= 2) return 'text-emerald-500';
    if (rate <= 5) return 'text-amber-500';
    return 'text-red-500';
  };

  if (loading) {
    return (
      <div className={cn("grid grid-cols-2 md:grid-cols-5 gap-3", className)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-5 gap-3", className)}>
      {/* Deliverability Score */}
      <MetricCard
        label="Deliverability"
        value={data.deliverabilityScore.toFixed(0)}
        trend={data.trends?.deliverability}
        icon={Activity}
        color={getDeliverabilityColor(data.deliverabilityScore)}
        flashKey="deliverability"
      />

      {/* Bounce Rate */}
      <MetricCard
        label="Bounce Rate"
        value={`${data.bounceRate.toFixed(1)}%`}
        trend={data.trends?.bounceRate}
        icon={AlertCircle}
        color={getRateColor(data.bounceRate)}
        flashKey="bounce"
      />

      {/* Spam Rate */}
      <MetricCard
        label="Spam Rate"
        value={`${data.spamRate.toFixed(1)}%`}
        trend={data.trends?.spamRate}
        icon={AlertCircle}
        color={getRateColor(data.spamRate)}
        flashKey="spam"
      />

      {/* Active Mailboxes */}
      <MetricCard
        label="Active Mailboxes"
        value={data.activeMailboxes}
        icon={Mail}
        color="text-primary"
        flashKey="mailboxes"
      />

      {/* Daily Volume */}
      <MetricCard
        label="Daily Vol."
        value={data.dailyVolume.toLocaleString()}
        trend={data.trends?.volume}
        icon={TrendingUp}
        color="text-primary"
        flashKey="volume"
      />
    </div>
  );
}

/**
 * Advanced SSE hook with reconnection, compression, and acknowledgment support
 */
export function useMetricsStream(userId: string, options?: {
  compression?: boolean;
  subscriptions?: string[];
  autoReconnect?: boolean;
}) {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>('connecting');
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const reconnectDelay = 5000;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus('connecting');
    setError(null);

    // Build URL with advanced options
    const params = new URLSearchParams();
    if (options?.compression) params.append('compression', 'true');
    if (options?.subscriptions) {
      options.subscriptions.forEach(sub => params.append('subscribe', sub));
    }
    
    const url = `/api/sse/connect?${params.toString()}`;
    
    try {
      eventSourceRef.current = new EventSource(url);

      eventSourceRef.current.onopen = () => {
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

      };

      eventSourceRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle compressed messages
          if (message._compressed && message._data) {
            // Decompress base64 data
            const compressed = atob(message._data);
            // Note: In production, you'd use a proper decompression library
            message.data = JSON.parse(compressed);
            delete message._compressed;
            delete message._data;
          }

          // Handle different message types
          if (message.type === 'metrics_update' || message.type === 'mailbox_health') {
            setData(message.data);
          } else if (message.type === 'alert') {
            console.warn('[SSE] Alert received:', message.data);
          } else if (message.type === 'system_status') {

          }

          // Send acknowledgment if required
          if (message.messageId && message.requiresAck) {
            fetch('/api/sse/ack', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId: message.clientId,
                messageId: message.messageId,
              }),
            }).catch(err => console.error('[SSE] Ack failed:', err));
          }
        } catch (err) {
          console.error('[SSE] Failed to parse message:', err);
        }
      };

      eventSourceRef.current.onerror = (err) => {
        console.error('[SSE] Connection error:', err);
        setConnectionStatus('disconnected');
        setError('Connection lost');
        
        if (options?.autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          setConnectionStatus('reconnecting');
          
          const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1); // Exponential backoff

          
          setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (err) {
      setError('Failed to connect');
      setConnectionStatus('disconnected');
    }
  }, [userId, options]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // Initial fetch
    fetch(`/api/metrics/${userId}`)
      .then(res => res.json())
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));

    // Connect to SSE
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [userId, connect]);

  return { data, loading, error, connectionStatus, reconnect: connect };
}
