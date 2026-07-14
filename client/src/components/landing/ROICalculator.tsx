import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Calculator, TrendingUp, DollarSign, Users, ArrowRight, Zap, Target, X } from "lucide-react";

// Helper for counting animation
const Counter = ({ value, prefix = "", suffix = "" }: { value: number, prefix?: string, suffix?: string }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = displayValue;
    const end = value;
    const duration = 1000;
    let startTime: number | null = null;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const current = Math.floor(progress * (end - start) + start);
      setDisplayValue(current);
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span>{prefix}{displayValue.toLocaleString()}{suffix}</span>;
};

export function ROICalculator() {
  const [leadsPerMonth, setLeadsPerMonth] = useState(100);
  const [avgDealValue, setAvgDealValue] = useState(500);
  const [currentConvRate, setCurrentConvRate] = useState(2);
  const [costPerLead, setCostPerLead] = useState(15);
  const [annualRevenueGoal, setAnnualRevenueGoal] = useState(500000);
  const [humanOffset, setHumanOffset] = useState(2500); // Standard SDR offset per 500 leads

  const calculations = useMemo(() => {
    const industryConversionRate = currentConvRate / 100;
    const audnixConversionRate = Math.min(industryConversionRate * 9, 0.35);

    const manualClosedDeals = Math.round(leadsPerMonth * industryConversionRate);
    const audnixClosedDeals = Math.round(leadsPerMonth * audnixConversionRate);

    const manualRevenue = manualClosedDeals * avgDealValue;
    const audnixRevenue = audnixClosedDeals * avgDealValue;

    const totalLeadCost = leadsPerMonth * costPerLead;
    const humanCapitalOffset = humanOffset * (leadsPerMonth / 500);

    const additionalRevenue = audnixRevenue - manualRevenue;
    const netProfitAudnix = audnixRevenue - totalLeadCost + humanCapitalOffset;
    const annualAudnixRevenue = (audnixRevenue + humanCapitalOffset) * 12;
    const goalAttainment = (annualAudnixRevenue / annualRevenueGoal) * 100;

    const multiplier = manualRevenue > 0 ? (audnixRevenue / manualRevenue).toFixed(2) : "9.0";

    return {
      manualClosedDeals,
      audnixClosedDeals,
      manualRevenue,
      audnixRevenue,
      additionalRevenue,
      totalLeadCost,
      humanCapitalOffset,
      netProfitAudnix,
      annualAudnixRevenue,
      goalAttainment,
      multiplier,
      audnixPercent: (audnixConversionRate * 100).toFixed(2)
    };
  }, [leadsPerMonth, avgDealValue, currentConvRate, costPerLead, annualRevenueGoal, humanOffset]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toLocaleString()}`;
  };

  return (
    <section className="py-40 px-4 relative overflow-hidden bg-background">
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[600px] bg-primary/5 blur-[120px] rounded-full" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background to-transparent z-10" />
      </div>

      <div className="max-w-6xl mx-auto relative z-20">
        <div className="text-center mb-24">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="px-6 py-2 rounded-full bg-white/5 border border-white/10 text-primary text-[10px] font-black uppercase tracking-[0.4em] mb-12 inline-block shadow-[0_0_20px_rgba(var(--primary),0.1)]"
          >
            Profitability Projection
          </motion.div>
          <h2 className="text-3xl md:text-6xl font-black text-foreground mb-8 tracking-tighter uppercase leading-[0.9]">
            Architect your <br />
            <span className="text-primary">Revenue Engine.</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-medium">
            Most legacy CRMs track leads. Audnix converts them. Use our deterministic model to see exactly how much revenue you're leaving on the table.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-12 items-start">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-10">
            <div className="glass-premium p-10 rounded-[2.5rem] border-white/5 space-y-12">

              {/* Leads Slider */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <label className="text-muted-foreground text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Users className="w-3 h-3 text-primary" /> Monthly Leads
                    </label>
                    <p className="text-foreground text-sm font-bold">Volume of inbound prospects</p>
                  </div>
                  <span className="text-4xl font-black text-foreground tracking-tighter">{leadsPerMonth}</span>
                </div>
                <Slider
                  value={[leadsPerMonth]}
                  onValueChange={([val]) => setLeadsPerMonth(val)}
                  min={50}
                  max={10000}
                  step={50}
                  className=""
                />
              </div>

              {/* Deal Value Slider */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <label className="text-white/40 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <DollarSign className="w-3 h-3 text-primary" /> Avg Ticket Size
                    </label>
                    <p className="text-white text-sm font-bold">Mean value of a closed deal</p>
                  </div>
                  <span className="text-4xl font-black text-white tracking-tighter">${avgDealValue}</span>
                </div>
                <Slider
                  value={[avgDealValue]}
                  onValueChange={([val]) => setAvgDealValue(val)}
                  min={100}
                  max={25000}
                  step={100}
                  className=""
                />
              </div>

              {/* Conversion Rate Slider */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <label className="text-white/40 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Target className="w-3 h-3 text-primary" /> Current Conv. Rate
                    </label>
                    <p className="text-white text-sm font-bold">Your current human-only baseline</p>
                  </div>
                  <span className="text-4xl font-black text-white tracking-tighter">{currentConvRate}%</span>
                </div>
                <Slider
                  value={[currentConvRate]}
                  onValueChange={([val]) => setCurrentConvRate(val)}
                  min={1}
                  max={10}
                  step={0.5}
                  className=""
                />
              </div>

              {/* Cost Per Lead Slider */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <label className="text-white/40 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Zap className="w-3 h-3 text-primary" /> Cost Per Lead
                    </label>
                    <p className="text-white text-sm font-bold">Acquisition cost per prospect</p>
                  </div>
                  <span className="text-4xl font-black text-white tracking-tighter">${costPerLead}</span>
                </div>
                <Slider
                  value={[costPerLead]}
                  onValueChange={([val]) => setCostPerLead(val)}
                  min={1}
                  max={500}
                  step={1}
                  className=""
                />
              </div>

              {/* Annual Goal Slider */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <label className="text-muted-foreground text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Target className="w-3 h-3 text-primary" /> Annual Target
                    </label>
                    <p className="text-foreground text-sm font-bold">Revenue goal for the year</p>
                  </div>
                  <span className="text-3xl font-black text-foreground tracking-tighter">{formatCurrency(annualRevenueGoal)}</span>
                </div>
                <Slider
                  value={[annualRevenueGoal]}
                  onValueChange={([val]) => setAnnualRevenueGoal(val)}
                  min={50000}
                  max={10000000}
                  step={50000}
                  className=""
                />
              </div>

              {/* Human Capital Offset Slider */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <label className="text-white/40 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Users className="w-3 h-3 text-primary" /> Human Offset
                    </label>
                    <p className="text-white text-sm font-bold">Labor cost saved (per 500 leads)</p>
                  </div>
                  <span className="text-4xl font-black text-white tracking-tighter">${humanOffset}</span>
                </div>
                <Slider
                  value={[humanOffset]}
                  onValueChange={([val]) => setHumanOffset(val)}
                  min={0}
                  max={10000}
                  step={500}
                  className=""
                />
              </div>
            </div>

            <div className="flex items-center gap-4 px-8 py-6 rounded-[2rem] bg-primary/5 border border-primary/10">
              <Zap className="w-5 h-5 text-primary" />
              <p className="text-primary/80 text-xs font-bold uppercase tracking-widest leading-relaxed">
                ROI based on real-time engagement optimization.
              </p>
            </div>
          </div>

          {/* Results Display */}
          <div className="lg:col-span-7 space-y-8">
            <div className="grid md:grid-cols-2 gap-8">
              {/* Legacy Result */}
              <div className="glass-premium p-10 rounded-[3rem] border-white/5 space-y-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <X className="w-12 h-12 text-red-500" />
                </div>
                <h4 className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.3em]">Manual Baseline ({currentConvRate}%)</h4>
                <div className="space-y-1">
                  <p className="text-4xl font-black text-foreground tracking-tighter">
                    <Counter value={calculations.manualRevenue} prefix="$" />
                  </p>
                  <p className="text-muted-foreground text-sm font-bold">Revenue Per Month</p>
                </div>
                <div className="pt-6 border-t border-white/5">
                  <p className="text-white/60 font-medium text-sm">
                    Total Deals: <span className="text-white font-black">{calculations.manualClosedDeals}</span>
                  </p>
                </div>
              </div>

              {/* Audnix Result */}
              <div className="p-10 rounded-[3rem] bg-primary border border-primary/20 space-y-6 relative overflow-hidden group shadow-[0_40px_80px_rgba(var(--primary),0.25)]">
                <div className="absolute top-0 right-0 p-6 opacity-20">
                  <Zap className="w-12 h-12 text-white fill-white" />
                </div>
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black text-white/50 uppercase tracking-[0.3em]">Audnix System ({calculations.audnixPercent}%)</h4>
                  <Badge className="bg-white text-primary font-black px-3 py-1 rounded-full">{calculations.multiplier}x</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-4xl font-black text-white tracking-tighter">
                    <Counter value={calculations.audnixRevenue} prefix="$" />
                  </p>
                  <p className="text-white/80 text-sm font-bold">Revenue Per Month</p>
                </div>
                <div className="pt-6 border-t border-white/20">
                  <p className="text-white/90 font-medium text-sm">
                    Total Deals: <span className="text-white font-black">{calculations.audnixClosedDeals}</span>
                  </p>
                  <p className="text-white/70 text-[11px] font-bold mt-2 flex items-center gap-2">
                    <Users className="w-3 h-3" /> Capital Offset: ${calculations.humanCapitalOffset.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Performance Stats Overlay */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="glass-premium p-6 rounded-3xl border-white/5">
                <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Annual Projection</p>
                <p className="text-2xl font-black text-white">{formatCurrency(calculations.annualAudnixRevenue)}</p>
              </div>
              <div className="glass-premium p-6 rounded-3xl border-white/5">
                <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Goal Attainment</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-black text-primary">{Math.round(calculations.goalAttainment)}%</p>
                  {calculations.goalAttainment >= 100 && <TrendingUp className="w-4 h-4 text-cyan-500" />}
                </div>
              </div>
              <div className="glass-premium p-6 rounded-3xl border-white/5">
                <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Lead Cost Load</p>
                <p className="text-2xl font-black text-white">{formatCurrency(calculations.totalLeadCost)}</p>
              </div>
            </div>

            {/* Bottom Summary Card */}
            <div className="glass-premium p-12 rounded-[3.5rem] border-white/10 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-10">
              <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />

              <div className="space-y-4 text-center md:text-left">
                <p className="text-primary text-[10px] font-black uppercase tracking-[0.3em]">Potential Incremental Yield</p>
                <p className="text-5xl md:text-6xl font-black text-foreground tracking-tighter">
                  +<Counter value={calculations.additionalRevenue} prefix="$" />
                </p>
                <p className="text-muted-foreground text-sm font-medium max-w-sm">
                  Additional revenue reclaimed from "lost" leads using autonomous follow-up and objection mastery.
                </p>
              </div>

              <div className="flex flex-col gap-4 w-full md:w-auto">
                <Link href="/auth">
                  <Button size="lg" className="h-16 px-10 rounded-2xl font-bold bg-white text-black hover:bg-white/90 transition-all w-full">
                    Claim This Revenue <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
                <p className="text-[10px] text-white/20 font-black uppercase tracking-widest text-center">No upfront cost to start</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
