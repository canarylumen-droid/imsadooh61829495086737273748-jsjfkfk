import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface PendingPayment {
  id: string;
  email: string;
  name: string;
  plan: string;
  amount: number;
  pending_date: string;
  subscription_id: string;
  stripe_session_id: string;
  verified_at: string;
}

interface Stats {
  trial_users: number;
  starter_users: number;
  pro_users: number;
  enterprise_users: number;
  total_users: number;
  pending_approvals: number;
  approved_payments: number;
}

export default function PaymentApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [autoApproving, setAutoApproving] = useState<Record<string, boolean>>({});

  const { data: pendingData, isLoading: pendingLoading } = useQuery<{ pending: PendingPayment[] }>({
    queryKey: ["/api/payment-approval/pending"],
  });

  const { data: statsData, isLoading: statsLoading } = useQuery<{ stats: Stats }>({
    queryKey: ["/api/payment-approval/stats"],
  });

  const pending = pendingData?.pending || [];
  const stats = statsData?.stats || null;
  const loading = pendingLoading || statsLoading;

  const approvePayment = async (userId: string) => {
    setAutoApproving((prev) => ({ ...prev, [userId]: true }));

    try {
      const response = await apiRequest("POST", `/api/payment-approval/approve/${userId}`, {
        reason: "Auto-approved from admin dashboard"
      });

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/payment-approval/pending"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-approval/stats"] });
        toast({
          title: "Approved ✅",
          description: "User has been upgraded",
        });
      }
    } catch (error) {
      console.error("Error approving payment:", error);
      toast({
        title: "Error",
        description: "Failed to approve payment",
        variant: "destructive",
      });
    } finally {
      setAutoApproving((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const rejectPayment = async (userId: string) => {
    try {
      const response = await apiRequest("POST", `/api/payment-approval/reject/${userId}`, {
        reason: "Admin rejected from dashboard"
      });

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/payment-approval/pending"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-approval/stats"] });
        toast({
          title: "Rejected",
          description: "Payment has been rejected",
        });
      }
    } catch (error) {
      console.error("Error rejecting payment:", error);
      toast({
        title: "Error",
        description: "Failed to reject payment",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Payment Approvals</h1>
        <p className="text-gray-400 mt-2">Verify payments and approve user upgrades</p>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-white">{stats.total_users}</div>
              <p className="text-sm text-gray-400">Total Users</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-white">{stats.trial_users}</div>
              <p className="text-sm text-gray-400">Trial Users</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-cyan-400">{stats.starter_users + stats.pro_users + stats.enterprise_users}</div>
              <p className="text-sm text-gray-400">Paid Users</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-green-400">{stats.approved_payments}</div>
              <p className="text-sm text-gray-400">Approved</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plan Breakdown */}
      {stats && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">User Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-2xl font-bold text-white">{stats.starter_users}</p>
                <p className="text-sm text-gray-400">Starter</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats.pro_users}</p>
                <p className="text-sm text-gray-400">Pro</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats.enterprise_users}</p>
                <p className="text-sm text-gray-400">Enterprise</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-400">{stats.pending_approvals}</p>
                <p className="text-sm text-gray-400">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Approvals */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">
          Pending Approvals ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6 text-center text-gray-400">
              No pending approvals at this time.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {pending.map((payment) => (
              <Card key={payment.id} className="bg-slate-800/50 border-cyan-500/20">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-white">{payment.name}</CardTitle>
                      <CardDescription>{payment.email}</CardDescription>
                    </div>
                    <span className="px-3 py-1 bg-cyan-500/20 text-cyan-300 rounded-full text-sm font-semibold capitalize">
                      {payment.plan}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Payment Verification Details */}
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <p className="text-sm font-semibold text-green-300 mb-2">✅ Payment Verified</p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Subscription ID:</span>
                          <code className="bg-slate-700 px-2 py-1 rounded text-green-300 font-mono text-xs">
                            {payment.subscription_id}
                          </code>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Verified At:</span>
                          <span className="text-white">{new Date(payment.verified_at).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Payment Details */}
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Amount:</span>
                        <span className="text-white font-semibold">${payment.amount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Paid:</span>
                        <span className="text-white">{new Date(payment.pending_date).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Session ID:</span>
                        <code className="bg-slate-700 px-2 py-1 rounded text-cyan-300 font-mono text-xs">
                          {payment.stripe_session_id.substring(0, 20)}...
                        </code>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="space-y-2 pt-2 border-t border-slate-700">
                      <AutoApproveButton
                        userId={payment.id}
                        onApprove={() => approvePayment(payment.id)}
                        isApproving={autoApproving[payment.id] || false}
                      />

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => rejectPayment(payment.id)}
                        className="w-full"
                        disabled={autoApproving[payment.id]}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AutoApproveButton({
  userId,
  onApprove,
  isApproving,
}: {
  userId: string;
  onApprove: () => void;
  isApproving: boolean;
}) {
  const [countdown, setCountdown] = useState(5);
  const [autoApproved, setAutoApproved] = useState(false);

  useEffect(() => {
    if (isApproving) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0 && !autoApproved) {
      setAutoApproved(true);
      onApprove();
    }
  }, [countdown, isApproving, autoApproved, onApprove]);

  if (isApproving || autoApproved) {
    return (
      <Button disabled className="w-full bg-green-500/20 text-green-300 cursor-not-allowed">
        ✅ Approved
      </Button>
    );
  }

  return (
    <Button
      onClick={onApprove}
      className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
      disabled={countdown > 0}
    >
      {countdown > 0 ? `Auto-approve in ${countdown}s` : "Approve"}
    </Button>
  );
}
