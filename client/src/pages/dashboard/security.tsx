import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, ShieldAlert, ShieldCheck, Globe, User, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useRealtime } from "@/hooks/use-realtime";
import { useToast } from "@/hooks/use-toast";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface SecurityViolation {
  ip: string;
  path: string;
  userAgent: string;
  timestamp: number;
}

export default function SecurityDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [realtimeLogs, setRealtimeLogs] = useState<SecurityViolation[]>([]);

  const { data, isLoading } = useQuery<{ logs: SecurityViolation[] }>({
    queryKey: ["/api/admin/security-logs"],
  });

  const { socket } = useRealtime();

  // Listen for real-time security alerts
  useEffect(() => {
    if (!socket) return;

    const onSecurityAlert = (violation: SecurityViolation) => {
      setRealtimeLogs((prev) => [violation, ...prev].slice(0, 50));
      toast({
        title: "Security Threat Blocked",
        description: `Blocked access to ${violation.path} from ${violation.ip}`,
        variant: "destructive",
      });
    };

    socket.on("SECURITY_ALERT", onSecurityAlert);
    return () => {
      socket.off("SECURITY_ALERT", onSecurityAlert);
    };
  }, [socket, toast]);

  const allLogs = [
    ...realtimeLogs,
    ...(data?.logs || []).filter(log => !realtimeLogs.some(r => r.timestamp === log.timestamp))
  ].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <PageWrapper className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Sentinel Security
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time monitoring and threat protection
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-sm font-medium">Sentinel Active</span>
        </div>
      </div>

      <ResponsiveGrid className="md:grid-cols-3 gap-6">
        <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Threats Blocked</CardTitle>
            <ShieldAlert className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allLogs.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Since last restart</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Unique Attacker IPs</CardTitle>
            <Globe className="w-4 h-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(allLogs.map(l => l.ip)).size}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Active threats</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Security Status</CardTitle>
            <AlertTriangle className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">Protected</div>
            <p className="text-xs text-muted-foreground mt-1">WordPress brute-force filter active</p>
          </CardContent>
        </Card>
      </ResponsiveGrid>

      <Card className="border-primary/10 bg-card/30 backdrop-blur-md overflow-hidden">
        <CardHeader className="border-b border-primary/5 bg-primary/5 px-6">
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Live Threat Log
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-primary/5">
                <TableHead className="w-[200px] text-[10px] tracking-wider uppercase font-semibold text-muted-foreground/60">IP Address</TableHead>
                <TableHead className="text-[10px] tracking-wider uppercase font-semibold text-muted-foreground/60">Target Path</TableHead>
                <TableHead className="text-[10px] tracking-wider uppercase font-semibold text-muted-foreground/60">User Agent</TableHead>
                <TableHead className="text-right text-[10px] tracking-wider uppercase font-semibold text-muted-foreground/60">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell colSpan={4} className="h-12 bg-muted/20" />
                  </TableRow>
                ))
              ) : allLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Shield className="w-8 h-8 opacity-20" />
                      No threats detected yet. Sentinel is standing by.
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                allLogs.map((log, i) => (
                  <TableRow key={i} className="group hover:bg-primary/5 border-primary/5 transition-colors">
                    <TableCell className="font-mono text-sm">
                      <Badge variant="outline" className="font-mono border-primary/20 bg-primary/5">
                        {log.ip}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-destructive px-2 py-0.5 rounded bg-destructive/10">
                        {log.path}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                      {log.userAgent}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground font-mono">
                      {format(log.timestamp, "HH:mm:ss")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageWrapper>
  );
}

function Activity({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
