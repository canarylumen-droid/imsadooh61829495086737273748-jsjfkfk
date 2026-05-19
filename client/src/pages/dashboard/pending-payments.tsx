
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  DollarSign, 
  Mail, 
  CheckCircle2, 
  RefreshCw, 
  ExternalLink,
  Search,
  AlertCircle,
  FileText,
  Clock,
  User as UserIcon,
  Crown,
  TrendingUp,
  Percent
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface PendingPayment {
  id: string;
  userId: string;
  leadId: string;
  fathomMeetingId: string | null;
  status: 'pending' | 'sent' | 'paid' | 'expired';
  readyToGoEmail: string | null;
  customPaymentLink: string | null;
  amountDetected: number | null;
  createdAt: string;
  updatedAt: string;
  lead?: {
    id: string;
    name: string;
    email: string;
    company: string | null;
  };
}

export default function PendingPaymentsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("pending");

  const { data: payments, isLoading } = useQuery<PendingPayment[]>({
    queryKey: ["/api/pending-payments"],
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/pending-payments/${id}/confirm`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-payments"] });
      toast({
        title: "Payment Confirmed",
        description: "The lead has been converted and AI campaigns unpaused.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Manual Confirmation Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const resendEmailMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/pending-payments/${id}/resend`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-payments"] });
      toast({
        title: "Email Resent",
        description: "Checkout email has been dispatched to the prospect.",
      });
    }
  });

  const updateLinkMutation = useMutation({
    mutationFn: async ({ id, link }: { id: string; link: string }) => {
      return apiRequest('PATCH', `/api/pending-payments/${id}/link`, { link });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending-payments"] });
      toast({
        title: "Link Updated",
        description: "Custom checkout link has been saved.",
      });
    }
  });

  const filteredPayments = payments?.filter(p => {
    const matchesSearch = p.lead?.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         p.lead?.email.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === 'all') return matchesSearch;
    if (activeTab === 'pending') return matchesSearch && (p.status === 'pending' || p.status === 'sent');
    if (activeTab === 'paid') return matchesSearch && p.status === 'paid';
    return matchesSearch;
  });

  // Calculate metrics for stats grid
  const activeOrders = payments?.filter(p => p.status === 'pending' || p.status === 'sent') || [];
  const confirmedOrders = payments?.filter(p => p.status === 'paid') || [];
  const totalPaidRevenue = confirmedOrders.reduce((sum, p) => sum + (p.amountDetected || 0), 0);
  const conversionRate = payments && payments.length > 0 
    ? Math.round((confirmedOrders.length / payments.length) * 100) 
    : 0;

  return (
    <PageWrapper className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Manual Link Management
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Manage autonomous payment triggers from Fathom calls. Verify receipts manually to unpause campaigns.
          </p>
        </div>
      </div>

      {/* Stats Summary Grid */}
      <ResponsiveGrid className="grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Confirmed Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalPaidRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Lifetime payments processed</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Orders</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeOrders.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting checkout completion</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conversion Rate</CardTitle>
            <Percent className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{conversionRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">Call-to-payment conversion ratio</p>
          </CardContent>
        </Card>
      </ResponsiveGrid>

      <Card className="border-border/40 bg-card/60 backdrop-blur-3xl overflow-hidden shadow-2xl">
        <CardHeader className="border-b border-border/10 pb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
              <TabsList className="bg-muted/30 p-1 rounded-2xl border border-border/10 h-11">
                <TabsTrigger value="pending" className="rounded-xl px-6 font-semibold uppercase tracking-wider text-[10px]">Active Orders</TabsTrigger>
                <TabsTrigger value="paid" className="rounded-xl px-6 font-semibold uppercase tracking-wider text-[10px]">Confirmed</TabsTrigger>
                <TabsTrigger value="all" className="rounded-xl px-6 font-semibold uppercase tracking-wider text-[10px]">History</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative w-full md:w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search leads..." 
                className="pl-12 h-11 rounded-2xl bg-muted/20 border-border/10 focus:bg-background focus:ring-4 focus:ring-primary/5 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[300px] text-[10px] font-semibold uppercase tracking-wider px-8">Prospect Detail</TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Detected Context</TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Checkout URL</TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wider px-8">Pipeline Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground animate-pulse">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span className="text-xs font-bold uppercase tracking-widest">Syncing with AI Engine...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredPayments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center gap-4">
                      <div className="p-4 rounded-full bg-muted/20">
                        <AlertCircle className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-bold uppercase">No Pending Transactions</h3>
                        <p className="text-xs text-muted-foreground">Transactions will appear here when AI detects 'Agreed to Pay' on your calls.</p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredPayments?.map((p) => (
                  <TableRow key={p.id} className="group hover:bg-primary/[0.02] transition-colors">
                    <TableCell className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10 shadow-sm">
                          <UserIcon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <Link href={`/dashboard/inbox`}>
                            <span className="text-sm font-semibold tracking-tight hover:text-primary cursor-pointer transition-colors truncate">{p.lead?.name}</span>
                          </Link>
                          <span className="text-[10px] font-medium text-muted-foreground truncate italic">{p.lead?.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary text-[9px] font-semibold tracking-wider py-0.5">
                            <DollarSign className="h-2.5 w-2.5 mr-1" />
                            APPROX ${p.amountDetected || '---'}
                          </Badge>
                          {p.fathomMeetingId && (
                            <Badge variant="secondary" className="text-[9px] font-bold py-0.5">
                              <Clock className="h-2.5 w-2.5 mr-1" />
                              CALL LOGGED
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5">
                          <Mail className="h-3 w-3" />
                          Last Trigger: {format(new Date(p.updatedAt), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 max-w-[200px]">
                        <Input 
                          defaultValue={p.customPaymentLink || ""} 
                          onBlur={(e) => {
                            if (e.target.value !== p.customPaymentLink) {
                              updateLinkMutation.mutate({ id: p.id, link: e.target.value });
                            }
                          }}
                          className="h-9 text-[11px] font-mono bg-muted/20 border-border/10 rounded-xl focus:bg-background transition-all"
                          placeholder="Paste link here..."
                        />
                        {p.customPaymentLink && (
                          <a href={p.customPaymentLink} target="_blank" rel="noreferrer" className="p-2 hover:bg-primary/10 rounded-xl transition-colors">
                            <ExternalLink className="h-4 w-4 text-primary" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={p.status === 'paid' ? 'default' : p.status === 'sent' ? 'secondary' : 'outline'}
                        className={p.status === 'paid' ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30 font-semibold uppercase tracking-wider text-[9px] px-3" : "font-semibold uppercase tracking-wider text-[9px] px-3"}
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-8 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {p.status !== 'paid' && (
                          <>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-9 rounded-xl border-primary/20 hover:bg-primary/10 font-semibold text-[10px] px-4"
                              onClick={() => resendEmailMutation.mutate(p.id)}
                              disabled={resendEmailMutation.isPending}
                            >
                              <Mail className="h-3.5 w-3.5 mr-2" />
                              RESEND LINK
                            </Button>
                            <Button 
                              variant="default" 
                              size="sm" 
                              className="h-9 rounded-xl bg-primary text-black hover:bg-primary/90 font-bold text-[10px] px-4 shadow-[0_4px_12px_rgba(var(--primary),.3)]"
                              onClick={() => confirmPaymentMutation.mutate(p.id)}
                              disabled={confirmPaymentMutation.isPending}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                              CONFIRM PAID
                            </Button>
                          </>
                        )}
                        {p.status === 'paid' && (
                          <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs bg-emerald-500/5 px-4 py-2 rounded-xl">
                            <Crown className="h-4 w-4 animate-bounce" />
                            CAMPAIGNS UNPAUSED
                          </div>
                        )}
                      </div>
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
