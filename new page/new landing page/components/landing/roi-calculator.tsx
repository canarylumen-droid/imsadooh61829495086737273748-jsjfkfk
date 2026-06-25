"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function ROICalculator() {
  const [monthlyLeads, setMonthlyLeads] = useState(1000);
  const [replyRate, setReplyRate] = useState(5);
  const [conversionRate, setConversionRate] = useState(0.5);
  const [avgDealValue, setAvgDealValue] = useState(5000);

  // Current metrics
  const currentReplies = monthlyLeads * (replyRate / 100);
  const currentConversions = currentReplies * (conversionRate / 100);
  const currentMonthlyRevenue = currentConversions * avgDealValue;
  const currentAnnualRevenue = currentMonthlyRevenue * 12;

  // Audnix improvements (3X+ boost)
  const audnixLeadMultiplier = 3.2;
  const audnixConversionBoost = 3.5;
  const audnixToolSavings = 400;

  // With Audnix metrics
  const audnixReplies = currentReplies * audnixLeadMultiplier;
  const audnixConversions = audnixReplies * (conversionRate * audnixConversionBoost) / 100;
  const audnixMonthlyRevenue = audnixConversions * avgDealValue;
  const audnixAnnualRevenue = audnixMonthlyRevenue * 12;

  // Financial impact
  const additionalMonthlyRevenue = audnixMonthlyRevenue - currentMonthlyRevenue;
  const totalMonthlySavings = additionalMonthlyRevenue + audnixToolSavings;
  const audnixMonthlyCost = 599;
  const netMonthlyBenefit = totalMonthlySavings - audnixMonthlyCost;
  const annualROI = (netMonthlyBenefit * 12 / (audnixMonthlyCost * 12)) * 100;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
    if (value >= 1000) return (value / 1000).toFixed(1) + "K";
    return Math.round(value).toString();
  };

  const handleResetDefaults = () => {
    setMonthlyLeads(1000);
    setReplyRate(5);
    setConversionRate(0.5);
    setAvgDealValue(5000);
  };

  return (
    <section id="roi-calculator" className="relative min-h-screen px-4 py-20 border-t border-[#1e1e1e] scroll-mt-[88px]">

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-4xl md:text-5xl font-bold text-white mb-4"
          >
            Calculate Your Revenue Impact
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-gray-400 text-sm md:text-base max-w-2xl mx-auto"
          >
            See exactly how much additional revenue Audnix AI can generate for your business with your current metrics
          </motion.p>
        </div>

        {/* Main Calculator Container */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8"
        >
          {/* Left Panel - Sliders */}
          <div className="lg:col-span-5 space-y-8">
            {/* Leads Input */}
            <div className="bg-[#0f1235]/60 backdrop-blur-sm border border-cyan-500/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Monthly Leads</label>
                <span className="text-xl font-bold text-white">{formatNumber(monthlyLeads)}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">Total outreach volume</p>
              <input
                type="range"
                min={500}
                max={1000000}
                step={100}
                value={monthlyLeads}
                onChange={(e) => setMonthlyLeads(Number(e.target.value))}
                className="w-full h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full appearance-none cursor-pointer accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>500</span>
                <span>1M</span>
              </div>
            </div>

            {/* Reply Rate Input */}
            <div className="bg-[#0f1235]/60 backdrop-blur-sm border border-cyan-500/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Reply Rate</label>
                <span className="text-xl font-bold text-white">{replyRate.toFixed(1)}%</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">Current reply conversation rate</p>
              <input
                type="range"
                min={0.1}
                max={30}
                step={0.1}
                value={replyRate}
                onChange={(e) => setReplyRate(Number(e.target.value))}
                className="w-full h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full appearance-none cursor-pointer accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>0.1%</span>
                <span>30%</span>
              </div>
            </div>

            {/* Conversion Rate Input */}
            <div className="bg-[#0f1235]/60 backdrop-blur-sm border border-cyan-500/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Conversion Rate</label>
                <span className="text-xl font-bold text-white">{conversionRate.toFixed(2)}%</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">Conversations to deals closed</p>
              <input
                type="range"
                min={0.1}
                max={15}
                step={0.1}
                value={conversionRate}
                onChange={(e) => setConversionRate(Number(e.target.value))}
                className="w-full h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full appearance-none cursor-pointer accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>0.1%</span>
                <span>15%</span>
              </div>
            </div>

            {/* Average Deal Value Input */}
            <div className="bg-[#0f1235]/60 backdrop-blur-sm border border-cyan-500/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Avg Deal Value</label>
                <span className="text-xl font-bold text-white">{formatCurrency(avgDealValue)}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">Average closed deal amount</p>
              <input
                type="range"
                min={100}
                max={500000}
                step={100}
                value={avgDealValue}
                onChange={(e) => setAvgDealValue(Number(e.target.value))}
                className="w-full h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full appearance-none cursor-pointer accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>$100</span>
                <span>$500K</span>
              </div>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetDefaults}
              className="w-full py-2 px-4 text-xs font-semibold text-cyan-400 border border-cyan-500/40 rounded-lg hover:bg-cyan-500/10 transition-colors"
            >
              Reset to Defaults
            </button>
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-7 space-y-6">
            {/* Current vs Audnix Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Current Revenue Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="bg-[#0f1235]/60 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6"
              >
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Current Revenue</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Monthly</p>
                    <p className="text-2xl font-bold text-white">{formatCurrency(currentMonthlyRevenue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Conversations: {Math.round(currentReplies)}</p>
                    <p className="text-xs text-gray-500">Closed Deals: {Math.round(currentConversions)}</p>
                  </div>
                </div>
              </motion.div>

              {/* Audnix Revenue Card - Highlight */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 backdrop-blur-sm border border-cyan-500/50 rounded-2xl p-6 lg:row-span-2 flex flex-col justify-between"
              >
                <div>
                  <p className="text-xs text-cyan-300 uppercase tracking-wider mb-3">With Audnix AI</p>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-cyan-300 mb-1">Monthly Revenue</p>
                      <p className="text-3xl font-bold text-cyan-300">{formatCurrency(audnixMonthlyRevenue)}</p>
                    </div>
                    <div className="border-t border-cyan-500/30 pt-4">
                      <p className="text-xs text-cyan-200 mb-2">Conversations: {Math.round(audnixReplies)}</p>
                      <p className="text-xs text-cyan-200">Closed Deals: {Math.round(audnixConversions)}</p>
                      <p className="text-xs text-cyan-200 mt-2">Capital Offset: {formatCurrency(audnixToolSavings)}</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Additional Revenue Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="bg-[#0f1235]/60 backdrop-blur-sm border border-green-500/30 rounded-2xl p-6"
              >
                <p className="text-xs text-green-400 uppercase tracking-wider mb-3">Additional Revenue</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Monthly Gain</p>
                    <p className="text-2xl font-bold text-green-400">+{formatCurrency(additionalMonthlyRevenue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Annual: +{formatCurrency(additionalMonthlyRevenue * 12)}</p>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Bottom Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="bg-[#0f1235]/60 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4"
              >
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Monthly Savings</p>
                <p className="text-xl font-bold text-white">{formatCurrency(totalMonthlySavings - audnixMonthlyCost)}</p>
                <p className="text-xs text-gray-500 mt-1">Revenue + Tools - Subscription</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="bg-[#0f1235]/60 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4"
              >
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Annual ROI</p>
                <p className="text-xl font-bold text-cyan-400">{Math.round(annualROI).toLocaleString()}%</p>
                <p className="text-xs text-gray-500 mt-1">Return on investment</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6 }}
                className="bg-[#0f1235]/60 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4"
              >
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Payback Period</p>
                <p className="text-xl font-bold text-white">{Math.max(0, Math.ceil(audnixMonthlyCost / (totalMonthlySavings - audnixMonthlyCost)))} months</p>
                <p className="text-xs text-gray-500 mt-1">Time to break even</p>
              </motion.div>
            </div>

            {/* CTA Button */}
            <motion.button
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-black font-semibold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 group"
            >
              Claim This Revenue
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </motion.button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
