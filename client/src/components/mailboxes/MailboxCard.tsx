import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Copy, Check, AlertTriangle, Shield, Mail } from 'lucide-react';

interface DNSRecord {
  valid: boolean;
  record?: string;
  issues?: string[];
}

interface MailboxHealth {
  spf: DNSRecord;
  dkim: DNSRecord;
  dmarc: DNSRecord;
  bounceRate: number;
  spamRate: number;
  deliverabilityScore: number;
}

interface MailboxCardProps {
  id: string;
  email: string;
  provider: string;
  connected: boolean;
  health?: MailboxHealth;
  lastSync?: string;
  onDisconnect?: (id: string) => void;
}

export function MailboxCard({ 
  id, 
  email, 
  provider, 
  connected, 
  health, 
  lastSync,
  onDisconnect 
}: MailboxCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null);

  const copyToClipboard = (text: string, recordType: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRecord(recordType);
    setTimeout(() => setCopiedRecord(null), 2000);
  };

  const getBadgeColor = (valid: boolean) => {
    return valid 
      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
      : 'bg-amber-500/10 text-amber-500 border-amber-500/20';
  };

  const getBadgeAnimation = (valid: boolean) => {
    return valid 
      ? 'shadow-[0_0_12px_rgba(16,185,129,0.3)]' 
      : 'shadow-[0_0_12px_rgba(245,158,11,0.3)]';
  };

  const deliverabilityColor = health?.deliverabilityScore ? 
    (health.deliverabilityScore >= 80 ? 'text-emerald-500' : 
     health.deliverabilityScore >= 60 ? 'text-amber-500' : 'text-red-500') : 
    'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border transition-all duration-300",
        connected 
          ? "bg-card/80 backdrop-blur-sm border-border/50 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5" 
          : "bg-muted/30 border-muted/50"
      )}
    >
      {/* Main Card Content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Mailbox Info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={cn(
              "p-2.5 rounded-xl shrink-0 transition-all duration-300",
              connected ? "bg-primary/10" : "bg-muted/50"
            )}>
              <Mail className={cn(
                "h-4 w-4 transition-colors",
                connected ? "text-primary" : "text-muted-foreground"
              )} />
            </div>
            
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-foreground truncate text-sm">
                  {email}
                </h3>
                {connected && (
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {provider}
                </span>
                {lastSync && (
                  <span className="text-[9px] text-muted-foreground/60">
                    Synced {new Date(lastSync).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Micro-badges & Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {health && (
              <div className="flex items-center gap-1.5">
                {/* SPF Badge */}
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className={cn(
                    "px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all duration-300",
                    getBadgeColor(health.spf.valid),
                    getBadgeAnimation(health.spf.valid)
                  )}
                >
                  SPF
                </motion.div>

                {/* DKIM Badge */}
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className={cn(
                    "px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all duration-300",
                    getBadgeColor(health.dkim.valid),
                    getBadgeAnimation(health.dkim.valid)
                  )}
                >
                  DKIM
                </motion.div>

                {/* DMARC Badge */}
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className={cn(
                    "px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all duration-300",
                    getBadgeColor(health.dmarc.valid),
                    getBadgeAnimation(health.dmarc.valid)
                  )}
                >
                  DMARC
                </motion.div>
              </div>
            )}

            {/* Expand Button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Deliverability Score */}
        {health && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Deliverability
              </span>
              <span className={cn(
                "text-lg font-black tabular-nums",
                deliverabilityColor
              )}>
                {health.deliverabilityScore.toFixed(0)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Expandable DNS Records Panel */}
      <AnimatePresence>
        {isExpanded && health && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border/50 bg-muted/30"
          >
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Domain Health & Authentication
                </h4>
              </div>

              {/* SPF Record */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    SPF Record
                  </span>
                  {!health.spf.valid && health.spf.issues && (
                    <div className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      <span className="text-[9px]">{health.spf.issues[0]}</span>
                    </div>
                  )}
                </div>
                {health.spf.record ? (
                  <div className="relative group">
                    <div className="bg-black/50 rounded-lg p-3 font-mono text-[10px] text-emerald-400 break-all">
                      {health.spf.record}
                    </div>
                    <button
                      onClick={() => copyToClipboard(health.spf.record!, 'spf')}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      {copiedRecord === 'spf' ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-white/70" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-[10px] text-red-400">
                    No SPF record found. Add: v=spf1 include:_spf.google.com ~all
                  </div>
                )}
              </div>

              {/* DKIM Record */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    DKIM Record
                  </span>
                  {!health.dkim.valid && health.dkim.issues && (
                    <div className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      <span className="text-[9px]">{health.dkim.issues[0]}</span>
                    </div>
                  )}
                </div>
                {health.dkim.record ? (
                  <div className="relative group">
                    <div className="bg-black/50 rounded-lg p-3 font-mono text-[10px] text-emerald-400 break-all">
                      {health.dkim.record}
                    </div>
                    <button
                      onClick={() => copyToClipboard(health.dkim.record!, 'dkim')}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      {copiedRecord === 'dkim' ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-white/70" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-[10px] text-red-400">
                    No DKIM record found. Configure with your email provider.
                  </div>
                )}
              </div>

              {/* DMARC Record */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    DMARC Record
                  </span>
                  {!health.dmarc.valid && health.dmarc.issues && (
                    <div className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      <span className="text-[9px]">{health.dmarc.issues[0]}</span>
                    </div>
                  )}
                </div>
                {health.dmarc.record ? (
                  <div className="relative group">
                    <div className="bg-black/50 rounded-lg p-3 font-mono text-[10px] text-emerald-400 break-all">
                      {health.dmarc.record}
                    </div>
                    <button
                      onClick={() => copyToClipboard(health.dmarc.record!, 'dmarc')}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      {copiedRecord === 'dmarc' ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-white/70" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-[10px] text-red-400">
                    No DMARC record found. Add: v=DMARC1; p=quarantine; rua=mailto:dmarc@{email.split('@')[1]}
                  </div>
                )}
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/50">
                <div className="bg-black/20 rounded-lg p-3">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                    Bounce Rate
                  </div>
                  <div className={cn(
                    "text-lg font-black tabular-nums",
                    health.bounceRate > 5 ? 'text-red-500' : 
                    health.bounceRate > 2 ? 'text-amber-500' : 'text-emerald-500'
                  )}>
                    {health.bounceRate.toFixed(1)}%
                  </div>
                </div>
                <div className="bg-black/20 rounded-lg p-3">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                    Spam Rate
                  </div>
                  <div className={cn(
                    "text-lg font-black tabular-nums",
                    health.spamRate > 5 ? 'text-red-500' : 
                    health.spamRate > 2 ? 'text-amber-500' : 'text-emerald-500'
                  )}>
                    {health.spamRate.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
