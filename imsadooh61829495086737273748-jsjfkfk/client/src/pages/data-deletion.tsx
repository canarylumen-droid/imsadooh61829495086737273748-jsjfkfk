import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, ArrowLeft, Mail, Shield, Clock, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Logo } from "@/components/ui/Logo";

export default function DataDeletion() {
  return (
    <div className="min-h-screen bg-black">
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

      <div className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
              <Trash2 className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-red-500">Data Deletion Request</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Delete Your Data</h1>
            <p className="text-xl text-muted-foreground">
              Request complete deletion of your account and all associated data
            </p>
          </motion.div>

          <motion.div
            className="space-y-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Shield className="w-6 h-6 text-primary" />
                Your Privacy Rights
              </h2>
              <p className="text-muted-foreground mb-4">
                Under GDPR, CCPA, and other privacy regulations, you have the right to request complete deletion of your personal data.
                When you submit a deletion request, we will permanently remove:
              </p>
              <ul className="space-y-2 text-muted-foreground">
                {[
                  "Your account information (email, name, profile)",
                  "All imported leads and contact data",
                  "Conversation history and messages",
                  "Voice recordings and AI voice clones",
                  "Integration tokens and connected accounts",
                  "Analytics data and usage history",
                  "Payment records (retained only as required by law)"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Mail className="w-6 h-6 text-primary" />
                How to Request Data Deletion
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                  <h3 className="font-semibold text-foreground mb-2">Option 1: Email Request (Recommended)</h3>
                  <p className="mb-3">
                    Send an email to <a href="mailto:privacy@audnixai.com" className="text-primary hover:underline font-semibold">privacy@audnixai.com</a> with:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Subject: "Data Deletion Request"</li>
                    <li>Your registered email address</li>
                    <li>Confirmation that you want all data permanently deleted</li>
                  </ul>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg border">
                  <h3 className="font-semibold text-foreground mb-2">Option 2: In-App Deletion</h3>
                  <p className="text-sm">
                    If you have access to your account, go to <strong>Settings → Account → Delete Account</strong> to immediately delete your account and all data.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Clock className="w-6 h-6 text-primary" />
                What Happens Next
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold">1</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Verification (24-48 hours)</h4>
                    <p className="text-sm">We verify your identity to prevent unauthorized deletion requests.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold">2</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Data Deletion (7 days)</h4>
                    <p className="text-sm">All your data is permanently deleted from our systems and backups.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold">3</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Confirmation Email</h4>
                    <p className="text-sm">You'll receive confirmation when deletion is complete.</p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-amber-500/10 border-amber-500/20">
              <div className="flex items-start gap-3">
                <Shield className="w-6 h-6 text-amber-500 flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold text-amber-600 dark:text-amber-400 mb-2">Important Note</h3>
                  <p className="text-sm text-muted-foreground">
                    Data deletion is <strong>permanent and irreversible</strong>. Once deleted, your data cannot be recovered.
                    If you only want to disconnect integrations or pause your account, please use the Settings page instead.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-8 bg-primary/5 border-primary/20">
              <h2 className="text-xl font-bold mb-4">Contact Information</h2>
              <ul className="space-y-2 text-muted-foreground">
                <li><strong>Privacy Email:</strong> <a href="mailto:privacy@audnixai.com" className="text-primary hover:underline">privacy@audnixai.com</a></li>
                <li><strong>Data Protection Officer:</strong> <a href="mailto:dpo@audnixai.com" className="text-primary hover:underline">dpo@audnixai.com</a></li>
                <li><strong>Mailing Address:</strong> audnixai.com, Inc., 251 18th Street, 7th Floor, New York, NY 10011, USA</li>
              </ul>
            </Card>
          </motion.div>

          <div className="text-center mt-12">
            <Link href="/">
              <Button size="lg" className="gap-2">
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
