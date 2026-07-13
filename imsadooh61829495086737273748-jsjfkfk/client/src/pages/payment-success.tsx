import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";

export default function PaymentSuccess() {
  const [, setLocation] = useLocation();
  const [marked, setMarked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<string>("");
  const [amount, setAmount] = useState<number>(0);

  useEffect(() => {
    const markPaymentPending = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const planParam = params.get("plan") || "starter";
        const amountParam = parseInt(params.get("amount") || "49");

        setPlan(planParam);
        setAmount(amountParam);

        // Get user ID (from session)
        const userRes = await fetch("/api/user");
        const userData = await userRes.json();
        const userId = userData.id;

        // Mark as pending approval
        const response = await fetch(`/api/payment-approval/mark-pending/${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan: planParam,
            amount: amountParam,
          }),
        });

        if (response.ok) {
          setMarked(true);
        }
      } catch (error) {
        console.error("Error marking payment:", error);
      } finally {
        setLoading(false);
      }
    };

    markPaymentPending();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-auth-gradient flex items-center justify-center p-6">
        <div className="text-center space-y-6">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin"></div>
            <div className="absolute inset-0 rounded-full border-2 border-primary/10"></div>
          </div>
          <p className="text-white/40 text-sm font-medium tracking-wide">Processing your investment...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-auth-gradient flex items-center justify-center p-4 md:p-8">
      <div className="max-w-md w-full bg-card/40 border border-border/40 rounded-3xl p-8 backdrop-blur-2xl text-center shadow-2xl overflow-hidden relative group">
        <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

        {marked ? (
          <div className="relative z-10">
            <div className="mb-8">
              <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">Payment Successful! 🎉</h1>
              <div className="flex flex-col gap-1 text-sm font-medium">
                <p className="text-muted-foreground">Plan: <span className="text-primary capitalize">{plan}</span></p>
                <p className="text-muted-foreground">Investment: <span className="text-primary">${amount}</span></p>
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/10 rounded-2xl p-6 mb-8 text-left space-y-3">
              <div className="flex items-center gap-3 text-primary">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <p className="text-sm font-bold uppercase tracking-wider">Pending Activation</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your payment has been logged. Our intelligent verification system is finalizing your account upgrade. You'll have full access in just a few moments.
              </p>
            </div>

            <div className="space-y-4">
              <Button
                onClick={() => setLocation("/dashboard")}
                className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-2xl shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Enter Dashboard
              </Button>
              <p className="text-[10px] text-muted-foreground/40 uppercase font-bold tracking-[0.2em]">
                Auto-redirecting in 5s...
              </p>
            </div>
          </div>
        ) : (
          <div className="relative z-10">
            <div className="mb-8">
              <div className="w-20 h-20 bg-destructive/10 border border-destructive/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">Sync Delayed</h1>
              <p className="text-muted-foreground text-sm">We couldn't automatically verify your payment record.</p>
            </div>

            <Button
              onClick={() => setLocation("/dashboard")}
              className="w-full h-14 border border-border/40 hover:bg-muted font-bold rounded-2xl transition-all"
            >
              Contact Support
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
