import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, Scale, AlertTriangle, CreditCard, Ban, CheckCircle2, ArrowLeft, Shield, UserCheck, Instagram, Check, ArrowRight } from "lucide-react";

import { Link } from "wouter";
import { Logo } from "@/components/ui/Logo";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2 text-white/60 hover:text-white hover:bg-white/5">
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Button>
            </Link>
            <Link href="/">
              <Logo />
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
              <Scale className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Legal Agreement</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Terms of Service</h1>
            <p className="text-xl text-muted-foreground">
              Last updated: February 9, 2026
            </p>
          </motion.div>

          {/* Quick Summary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="p-6 mb-12 bg-primary/5 border-primary/20">
              <h2 className="text-xl font-bold mb-4">Agreement Summary</h2>
              <p className="text-muted-foreground mb-4">
                By using audnixai.com, you agree to these terms. Here's what you need to know:
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  "3-day free trial, then paid subscription",
                  "You're responsible for your integrations",
                  "AI automation follows platform policies",
                  "Cancel anytime, no hidden fees"
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Content Sections */}
          <div className="space-y-12">
            <section>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-black uppercase tracking-widest">1. Agreement to Terms</h2>
              </div>
              <div className="p-8 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md space-y-4">
                <p>
                  By accessing or using audnixai.com's services, you agree to be bound by these Terms of Service and our Privacy Policy. If you disagree with any part of these terms, you may not access our service.
                </p>
                <p>
                  These terms apply to all users, including but not limited to visitors, registered users, content creators, and businesses using audnixai.com for sales automation.
                </p>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <UserCheck className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-black uppercase tracking-widest">2. Use of Service</h2>
              </div>
              <div className="p-8 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md space-y-6 text-white/70">
                <p>You agree to use audnixai.com only for lawful purposes and in accordance with these Terms. You are prohibited from:</p>
                <ul className="grid gap-4">
                  {[
                    "Violating any local, state, or international laws",
                    "Spamming or sending unsolicited commercial messages (CAN-SPAM compliance required)",
                    "Using the service for fraudulent or deceptive purposes",
                    "Attempting to interfere with the proper working of the service",
                    "Scraping or harvesting data from the service without authorization"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-primary mt-1 flex-shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <Instagram className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-black uppercase tracking-widest">3. Instagram Integration</h2>
              </div>
              <div className="p-8 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md space-y-6">
                <ul className="grid gap-6 text-white/70">
                  <li className="space-y-4">
                    <p className="font-bold text-white">Compliance Overview</p>
                    <ul className="space-y-3 text-sm">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        audnixai.com uses the official Instagram Graph API
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        Compliance with Meta Platform Terms is mandatory
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-primary" />
                        No storage of Instagram passwords
                      </li>
                    </ul>
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-black uppercase tracking-widest">4. AI-Generated Content</h2>
              </div>
              <div className="p-8 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md space-y-6">
                <div className="space-y-4">
                  <p className="text-sm text-white/70">
                    <strong>Ownership:</strong> You own AI-generated messages created by audnixai.com for your leads. However, you are responsible for ensuring these messages comply with platform policies and legal regulations.
                  </p>
                  <p className="text-sm text-white/70">
                    <strong>Training Data:</strong> With your consent (opt-in), anonymized conversation data may be used to improve AI models. You can opt out at any time in Settings.
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Additional Sections */}
          <div className="mt-12 space-y-8">
            <Card className="p-8 bg-white/5 border-white/10">
              <h2 className="text-2xl font-bold mb-4">7. Disclaimer of Warranties</h2>
              <div className="space-y-3 text-muted-foreground">
                <p className="font-semibold text-foreground italic">
                  audnixai.com IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
                </p>
                <p>We do not guarantee:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Uninterrupted Service:</strong> Maintenance or technical issues may occur</li>
                  <li><strong>Specific Results:</strong> No guarantee of conversion rates or business outcomes</li>
                  <li><strong>Platform Immunity:</strong> We cannot prevent third-party platform restrictions</li>
                  <li><strong>AI Accuracy:</strong> AI messages may require human review</li>
                </ul>
              </div>
            </Card>

            <Card className="p-8 bg-white/5 border-white/10">
              <h2 className="text-2xl font-bold mb-4">8. Limitation of Liability</h2>
              <div className="space-y-3 text-muted-foreground">
                <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, audnixai.com SHALL NOT BE LIABLE FOR:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Lost profits, revenue, or business opportunities</li>
                  <li>Instagram or email account suspensions</li>
                  <li>Data loss due to user error or third-party failures</li>
                </ul>
              </div>
            </Card>

            <Card className="p-8 bg-white/5 border-white/10 border-amber-500/20 bg-amber-500/5">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
                9. AI Communications Disclaimer
              </h2>
              <p className="text-sm text-muted-foreground">
                <strong>Important:</strong> AI-generated messages are informational only and do not represent official company commitments. You are responsible for all AI content sent through our platform.
              </p>
            </Card>

            <Card className="p-8 bg-primary/5 border-primary/20">
              <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
              <div className="grid sm:grid-cols-2 gap-6 text-muted-foreground">
                <div className="space-y-2">
                  <p className="font-bold text-white">Legal & Support</p>
                  <p>legal@audnixai.com</p>
                  <p>support@audnixai.com</p>
                </div>
                <div className="space-y-2">
                  <p className="font-bold text-white">Location</p>
                  <p>audnixai.com, Inc.</p>
                  <p>New York, NY 10011, USA</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="mt-12 pb-24 text-center">
            <Link href="/">
              <Button variant="ghost" className="gap-2 text-white/40 hover:text-white">
                <ArrowLeft className="w-4 h-4" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

