import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MetricsGrid, useMetricsStream } from '@/components/dashboard/MetricsGrid';
import { MailboxCard } from '@/components/mailboxes/MailboxCard';
import { PageWrapper } from '@/components/ui/page-wrapper';
import { Button } from '@/components/ui/button';
import { RefreshCw, Plus, Shield } from 'lucide-react';

interface MailboxData {
  id: string;
  email: string;
  provider: string;
  connected: boolean;
  health?: {
    spf: { valid: boolean; record?: string };
    dkim: { valid: boolean; record?: string };
    dmarc: { valid: boolean; record?: string };
    bounceRate: number;
    spamRate: number;
    deliverabilityScore: number;
  };
  lastSync?: string;
}

export default function DeliverabilityPage() {
  const [selectedMailbox, setSelectedMailbox] = useState<string | null>(null);
  
  // Fetch mailboxes
  const { data: mailboxes, isLoading: mailboxesLoading, refetch: refetchMailboxes } = useQuery<MailboxData[]>({
    queryKey: ['/api/integrations'],
    select: (data: any) => data.integrations?.filter((i: any) => 
      ['custom_email', 'gmail', 'outlook'].includes(i.provider)
    ) || [],
  });

  // Use SSE streaming for real-time metrics
  const { data: metrics, loading: metricsLoading } = useMetricsStream('current-user-id');

  const handleRefresh = () => {
    refetchMailboxes();
  };

  return (
    <PageWrapper className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Deliverability Dashboard
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Real-time monitoring of email authentication, bounce rates, and spam protection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={mailboxesLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${mailboxesLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Mailbox
          </Button>
        </div>
      </div>

      {/* Metrics Grid - Consolidated KPIs */}
      <MetricsGrid
        data={metrics || {
          deliverabilityScore: 85,
          bounceRate: 2.1,
          spamRate: 1.8,
          activeMailboxes: mailboxes?.length || 0,
          dailyVolume: 1250,
          trends: {
            deliverability: 5.2,
            bounceRate: -0.3,
            spamRate: -0.5,
            volume: 12.5,
          },
        }}
        loading={metricsLoading}
      />

      {/* Mailboxes Grid - Using new MailboxCard component */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Connected Mailboxes
          </h2>
          <span className="text-sm text-muted-foreground">
            {mailboxes?.length || 0} active
          </span>
        </div>

        {mailboxesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-40 rounded-2xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : mailboxes && mailboxes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mailboxes.map((mailbox) => (
              <MailboxCard
                key={mailbox.id}
                id={mailbox.id}
                email={mailbox.email}
                provider={mailbox.provider}
                connected={mailbox.connected}
                health={mailbox.health}
                lastSync={mailbox.lastSync}
                onDisconnect={(id) => console.log('Disconnect:', id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No mailboxes connected
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              Connect your email accounts to monitor deliverability
            </p>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Connect First Mailbox
            </Button>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
