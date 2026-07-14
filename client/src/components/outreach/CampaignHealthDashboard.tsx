import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRealtime } from '@/hooks/use-realtime';
import { Loader2, Activity, Mail, RefreshCw, AlertTriangle } from 'lucide-react';

interface ImportProgressData {
  campaignId: string;
  total: number;
  processed: number;
  valid: number;
  failed: number;
  percentage: number;
}

interface CampaignHealthDashboardProps {
  campaignId: string;
  initialFleetSpeedPerHr?: number;
  initialActiveWorkers?: number;
}

export const CampaignHealthDashboard: React.FC<CampaignHealthDashboardProps> = ({ 
  campaignId, 
  initialFleetSpeedPerHr = 0, 
  initialActiveWorkers = 0 
}) => {
  const [progress, setProgress] = useState<ImportProgressData | null>(null);
  const [stuckCount, setStuckCount] = useState(0);
  const [isRequeuing, setIsRequeuing] = useState(false);
  const [fleetSpeedPerHr, setFleetSpeedPerHr] = useState(initialFleetSpeedPerHr);
  const [activeWorkers, setActiveWorkers] = useState(initialActiveWorkers);

  // Listen to WebSocket events dynamically routed from verification-pipeline and active-watchdog
  const { socket } = useRealtime();

  useEffect(() => {
    if (!socket) return;

    const onImportProgress = (data: ImportProgressData) => {
      if (data.campaignId === campaignId) setProgress(data);
    };
    const onWatchdogAlert = (data: any) => {
      if (data.type === 'stuck_leads_released' || data.type === 'manual_force_requeue') {
        setStuckCount(0);
      } else if (data.type === 'stuck_leads_detected') {
        setStuckCount(data.count);
      }
    };
    const onCampaignStats = (data: any) => {
      if (data.campaignId === campaignId) {
        if (typeof data.fleetSpeed === 'number') setFleetSpeedPerHr(data.fleetSpeed);
        if (typeof data.activeWorkers === 'number') setActiveWorkers(data.activeWorkers);
      }
    };

    socket.on('import_progress', onImportProgress);
    socket.on('watchdog_alert', onWatchdogAlert);
    socket.on('campaign_stats_updated', onCampaignStats);

    return () => {
      socket.off('import_progress', onImportProgress);
      socket.off('watchdog_alert', onWatchdogAlert);
      socket.off('campaign_stats_updated', onCampaignStats);
    };
  }, [socket, campaignId]);

  const handleForceRequeue = async () => {
    setIsRequeuing(true);
    try {
      const res = await fetch(`/api/outreach/campaigns/${campaignId}/force-requeue`, { method: 'POST' });
      if (res.ok) {
        setStuckCount(0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRequeuing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-slate-900 dark:to-slate-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 flex items-center">
              <Activity className="w-4 h-4 mr-2 text-indigo-500" />
              Global Fleet Speed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fleetSpeedPerHr.toLocaleString()}</div>
            <p className="text-xs text-slate-500">Emails / Hour</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-white dark:from-slate-900 dark:to-slate-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 flex items-center">
              <RefreshCw className="w-4 h-4 mr-2 text-emerald-500" />
              Active Workers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeWorkers}</div>
            <p className="text-xs text-slate-500">Mailboxes processing</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-rose-50 to-white dark:from-slate-900 dark:to-slate-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 flex items-center">
              <AlertTriangle className={`w-4 h-4 mr-2 ${stuckCount > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
              Stuck Leads
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-between items-center">
            <div>
              <div className={`text-2xl font-bold ${stuckCount > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                {stuckCount}
              </div>
              <p className="text-xs text-slate-500">Pending Watchdog Auto-Release</p>
            </div>
            {stuckCount > 0 && (
              <Button 
                size="sm" 
                variant="destructive" 
                onClick={handleForceRequeue} 
                disabled={isRequeuing}
              >
                {isRequeuing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Force Re-Queue
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {progress && progress.percentage < 100 && (
        <Card className="border-indigo-100 dark:border-indigo-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500 mr-2" />
                Pre-Flight Verification Running
              </span>
              <Badge variant="outline" className="bg-indigo-50 text-indigo-700">
                {progress.percentage}%
              </Badge>
            </CardTitle>
            <CardDescription>
              Verifying syntax and MX records for 100k+ high-concurrency import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progress.percentage} className="h-2" />
            <div className="flex justify-between text-sm text-slate-500">
              <span className="flex items-center"><Mail className="w-3 h-3 mr-1"/> Processed: {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
              <span className="text-emerald-600">Valid: {progress.valid.toLocaleString()}</span>
              <span className="text-rose-500">Failed: {progress.failed.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
