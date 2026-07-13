import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Link } from "wouter";
import { AlertTriangle, TrendingDown, TrendingUp, DollarSign, Zap, ArrowRight, Cpu, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

const presets = {
  creator: { leads: 500, dealValue: 150, closeRate: 2 },
  agency: { leads: 2000, dealValue: 500, closeRate: 3 },
  power: { leads: 5000, dealValue: 1000, closeRate: 4 },
};

type RecoveryModel = "conservative" | "realistic" | "optimistic";

export function ROICalculator() {
  const [leads, setLeads] = useState(500);
  const [dealValue, setDealValue] = useState(150);
  const [closeRate, setCloseRate] = useState(2);
  const [recoveryModel, setRecoveryModel] = useState<RecoveryModel>("realistic");

  const calculations = useMemo(() => {
    const optimalCloseRate = 0.18;
    const currentCloseDecimal = closeRate / 100;

    const currentDeals = Math.round(leads * currentCloseDecimal);
    const potentialDeals = Math.round(leads * optimalCloseRate);
    const lostDeals = Math.max(0, potentialDeals - currentDeals);
    const lostRevenue = lostDeals * dealValue;

    let recoveredDeals = 0;
    switch (recoveryModel) {
      case "conservative": recoveredDeals = Math.round(lostDeals * 0.27); break;
      case "realistic": recoveredDeals = Math.round(lostDeals * 0.55); break;
      case "optimistic": recoveredDeals = Math.round(lostDeals * 0.85); break;
    }
    const recoveredRevenue = recoveredDeals * dealValue;

    return { lostRevenue, recoveredRevenue, lostDeals, recoveredDeals };
  }, [leads, dealValue, closeRate, recoveryModel]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <section id="calc" className="py-24 px-4 relative overflow-hidden bg-background">
      <div className="absolute inset-0 bg-grid opacity-[0.03]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[1200px] bg-primary/5 blur-[150px] rounded-full pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="text-center mb-24">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider mb-8"
          >
            <Activity className="w-3.5 h-3.5" />
            ROI Potential Analysis
          </motion.div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-8">
            The cost of <span className="text-primary">slow response.</span>
          </h2>
          <p className="text-muted-foreground text-xl max-w-2xl mx-auto font-medium">
            Every minute a lead waits is revenue lost. Audnix helps you recapture missed opportunities instantly.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-8">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-8">
            <Card className="p-8 md:p-10 rounded-3xl border-border/50 bg-card/50 backdrop-blur-sm shadow-xl">
              <div className="space-y-10">
                <div className="space-y-6">
                  <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <Label className="flex items-center gap-2">
                      Monthly Leads
                    </Label>
                    <span className="text-lg text-foreground font-bold">{leads.toLocaleString()}</span>
                  </div>
                  <Slider value={[leads]} onValueChange={(v) => setLeads(v[0])} min={50} max={10000} step={50} />
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <Label className="flex items-center gap-2">
                      Average Deal Value
                    </Label>
                    <span className="text-lg text-foreground font-bold">${dealValue}</span>
                  </div>
                  <Slider value={[dealValue]} onValueChange={(v) => setDealValue(v[0])} min={50} max={10000} step={50} />
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <Label className="flex items-center gap-2">
                      Current Close Rate
                    </Label>
                    <span className="text-lg text-foreground font-bold">{closeRate}%</span>
                  </div>
                  <Slider value={[closeRate]} onValueChange={(v) => setCloseRate(v[0])} min={1} max={30} step={1} />
                </div>

                <div className="flex flex-wrap gap-2 pt-4">
                  {Object.keys(presets).map((p) => (
                    <Button
                      key={p}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const preset = presets[p as keyof typeof presets];
                        setLeads(preset.leads); setDealValue(preset.dealValue); setCloseRate(preset.closeRate);
                      }}
                      className="rounded-full text-[10px] font-bold border-border/50 hover:bg-muted"
                    >
                      {p} preset
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* Results */}
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="p-8 md:p-10 rounded-3xl border-border/30 bg-muted/20 flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center text-destructive mb-8">
                  <TrendingDown className="w-6 h-6" />
                </div>
                <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mb-2">Estimated Revenue Loss</p>
                <h3 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                  {formatCurrency(calculations.lostRevenue)}
                </h3>
              </div>
              <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                Potential revenue lost due to <span className="text-destructive font-bold">delayed responses</span> and missed engagement opportunities.
              </p>
            </Card>

            <Card className="p-8 md:p-10 rounded-3xl border-primary/20 bg-primary/5 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-6 right-6 flex gap-1.5">
                {(["conservative", "realistic", "optimistic"] as RecoveryModel[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setRecoveryModel(m)}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${recoveryModel === m ? "bg-primary w-6" : "bg-muted-foreground/30"}`}
                  />
                ))}
              </div>
              <div>
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-8">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <p className="text-primary/70 text-[10px] font-bold uppercase tracking-widest mb-2">Recovered with Audnix</p>
                <h3 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6">
                  {formatCurrency(calculations.recoveredRevenue)}
                </h3>
              </div>
              <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                Based on a <span className="text-primary font-bold">{recoveryModel}</span> recovery model, Audnix can recapture up to {calculations.recoveredDeals} additional deals.
              </p>
            </Card>

            {/* CTA Bar */}
            <Card className="md:col-span-2 p-8 rounded-3xl border-border/50 bg-card flex flex-col xl:flex-row items-center justify-between gap-8 relative overflow-hidden">
              <div className="flex flex-wrap justify-center xl:justify-start gap-10">
                <div className="text-center xl:text-left">
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mb-1.5">Potential ROI</p>
                  <p className="text-3xl font-bold tracking-tight">{Math.round(calculations.recoveredRevenue / 99)}x</p>
                </div>
                <div className="text-center xl:text-left">
                  <p className="text-primary/70 text-[10px] font-bold uppercase tracking-widest mb-1.5">Recovery Yield</p>
                  <div className="flex items-center gap-3">
                    <Activity className="w-5 h-5 text-primary" />
                    <p className="text-3xl font-bold tracking-tight">
                      {Math.round((calculations.recoveredRevenue / 199) * 100)}%
                    </p>
                  </div>
                </div>
              </div>
              <Link href="/auth">
                <Button className="h-14 px-10 rounded-2xl font-semibold shadow-lg shadow-primary/20">
                  Start recovering revenue <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
