
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Shield, Lock, Eye, Database, UserCheck, FileText, ArrowLeft, Mail, Calendar, MessageSquare, Phone } from "lucide-react";
import { Link } from "wouter";
import { Logo } from "@/components/ui/Logo";

export default function PrivacyPolicy() {
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
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Enterprise-Grade Privacy</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Privacy Policy</h1>
            <p className="text-xl text-muted-foreground">
              Last updated: February 9, 2026
            </p>
          </motion.div>

          {/* Quick Summary Cards */}
          <div className="grid md:grid-cols-3 gap-4 mb-12">
            {[
              { icon: Lock, title: "AES-256-GCM Encrypted", desc: "Military-grade encryption" },
              { icon: Eye, title: "Zero Data Selling", desc: "We never sell your data" },
              { icon: UserCheck, title: "GDPR + CCPA Compliant", desc: "Full data ownership" }
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
              >
                <Card className="p-6 text-center border-primary/20 hover:border-primary/40 transition-colors">
                  <item.icon className="w-8 h-8 text-primary mx-auto mb-3" />
                  <h3 className="font-semibold mb-1">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Content Sections */}
          <motion.div
            className="space-y-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Database className="w-6 h-6 text-primary" />
                Information We Collect & Why
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <div>
                  <h3 className="font-semibold text-foreground mb-2">Account Information</h3>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Email address (for authentication and notifications)</li>
                    <li>Name (for personalization)</li>
                    <li>Subscription plan (to enforce usage limits)</li>
                    <li>Billing information (processed securely via Stripe - we never store card details)</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-8 border-primary/20">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Mail className="w-6 h-6 text-primary" />
                Business Email Integration (Custom SMTP)
              </h2>
              <div className="space-y-6 text-muted-foreground">
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    Why We Need Email Access
                  </h3>
                  <p className="text-sm">
                    audnixai.com automates lead follow-ups via email. Connect your business email using Custom SMTP
                    to send and receive messages through your own email server.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-3">How Custom SMTP Works</h3>

                  <div className="space-y-4">
                    <div className="border-l-4 border-emerald-500 pl-4">
                      <h4 className="font-semibold text-foreground">Sending Emails</h4>
                      <p className="text-sm mt-1"><strong>What it allows:</strong> Send emails from your business email address</p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>Send AI-generated follow-up emails to leads automatically</li>
                        <li>Reply to lead inquiries with context-aware, personalized responses</li>
                        <li>Send nurture sequences and booking links</li>
                      </ul>
                    </div>

                    <div className="border-l-4 border-cyan-500 pl-4">
                      <h4 className="font-semibold text-foreground">Reading Emails (IMAP)</h4>
                      <p className="text-sm mt-1"><strong>What it allows:</strong> Read incoming lead messages</p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>Monitor incoming lead messages in real-time</li>
                        <li>Understand conversation history for context-aware AI replies</li>
                        <li>Detect follow-up opportunities</li>
                      </ul>
                      <p className="text-sm mt-2 text-cyan-400"><strong>What we DON'T do:</strong> We only access emails from leads you import.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <h4 className="font-semibold text-emerald-400 mb-2">✅ Secure Connection</h4>
                  <p className="text-sm">
                    Your SMTP credentials are encrypted with AES-256-GCM and stored securely.
                    We never store full email content - only conversation metadata for AI context.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-8 border-primary/20">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Calendar className="w-6 h-6 text-primary" />
                Calendly Integration - Auto-Booking Explanation
              </h2>
              <div className="space-y-6 text-muted-foreground">
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    Auto-Booking with Calendly
                  </h3>
                  <p className="text-sm">
                    audnixai.com integrates with Calendly to automatically book calls with leads. When a lead shows interest,
                    our AI sends them your Calendly link so they can book directly on your calendar.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-3">How Auto-Booking Works</h3>

                  <div className="space-y-4">
                    <div className="border-l-4 border-emerald-500 pl-4">
                      <h4 className="font-semibold text-foreground">1. Calendly Link Integration</h4>
                      <p className="text-sm mt-1"><strong>What happens:</strong> Connect your Calendly account or paste your booking link</p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>AI detects when leads are ready to book a call</li>
                        <li>Automatically sends your Calendly link in the conversation</li>
                        <li>Leads book directly on your calendar - no back-and-forth</li>
                        <li>You get notified when new bookings are made</li>
                      </ul>
                      <p className="text-sm mt-2 text-emerald-400"><strong>Your control:</strong> You set your availability in Calendly. We just share the link at the right moment.</p>
                    </div>

                    <div className="border-l-4 border-cyan-500 pl-4">
                      <h4 className="font-semibold text-foreground">2. Booking Confirmation</h4>
                      <p className="text-sm mt-1"><strong>What happens:</strong> After a lead books</p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>Calendly sends both you and the lead confirmation emails</li>
                        <li>Event is added to your calendar automatically</li>
                        <li>Audnix tracks the booking in your lead pipeline</li>
                        <li>Lead status updates to "Booked Call"</li>
                      </ul>
                      <p className="text-sm mt-2 text-cyan-400"><strong>Privacy:</strong> We only know that a booking was made. We don't access your Calendly calendar data.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <h4 className="font-semibold text-emerald-400 mb-2">✅ Calendly Integration Benefits</h4>
                  <ul className="text-sm space-y-1">
                    <li>✓ No manual scheduling - leads book when they're hot</li>
                    <li>✓ Your availability is always accurate (managed in Calendly)</li>
                    <li>✓ Automatic reminders sent to leads before calls</li>
                    <li>✓ Disconnect anytime without losing lead data</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-8 border-primary/20">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <MessageSquare className="w-6 h-6 text-primary" />
                Instagram Integration - Detailed Access Explanation
              </h2>
              <div className="space-y-6 text-muted-foreground">
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                  <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    Why We Need Instagram Access
                  </h3>
                  <p className="text-sm">
                    audnixai.com automates Instagram DM replies and comment engagement. We need access to read incoming messages,
                    detect buying intent in comments, and send personalized follow-ups.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-3">What We Access</h3>

                  <div className="space-y-4">
                    <div className="border-l-4 border-blue-500 pl-4">
                      <h4 className="font-semibold text-foreground">Instagram Direct Messages (DMs)</h4>
                      <p className="text-sm mt-1"><strong>What we access:</strong></p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>Incoming DMs from leads (messages sent to you)</li>
                        <li>Your outgoing DM history (to understand conversation context)</li>
                        <li>Message metadata (timestamps, read status, sender profile)</li>
                      </ul>
                      <p className="text-sm mt-2"><strong>Why we need it:</strong></p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>Detect when leads message you with questions or interest</li>
                        <li>Understand full conversation history for context-aware AI replies</li>
                        <li>Send automated follow-ups if leads go silent</li>
                        <li>Handle objections and book calls via DM</li>
                      </ul>
                      <p className="text-sm mt-2"><strong>Security:</strong> DM credentials are AES-256 encrypted and never logged in plain text.</p>
                    </div>

                    <div className="border-l-4 border-purple-500 pl-4">
                      <h4 className="font-semibold text-foreground">Post Comments</h4>
                      <p className="text-sm mt-1"><strong>What we access:</strong></p>
                      <ul className="list-disc list-inside text-sm ml-4 space-y-1 mt-2">
                        <li>Comments on your posts (public data)</li>
                        <li>Commenter usernames and profile info</li>
                        <li>Emoji reactions and engagement signals</li>
                        <li>Reply to interested commenters automatically</li>
                      </ul>
                      <p className="text-sm mt-2 text-purple-400"><strong>Privacy:</strong> Comments are public data. We only process comments on YOUR posts.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <h4 className="font-semibold text-emerald-400 mb-2">✅ Official Instagram Graph API</h4>
                  <p className="text-sm">
                    audnixai.com uses the official Instagram Graph API for all Instagram integrations. This ensures full compliance
                    with Meta's platform policies and provides secure, reliable access to messaging and content features.
                  </p>
                  <p className="text-sm mt-2">
                    <strong>OAuth Authentication:</strong> We use Meta's official OAuth flow. Your credentials are never accessed or stored by audnixai.com.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Lock className="w-6 h-6 text-primary" />
                How We Protect Your Data (Enterprise-Grade Security)
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <div>
                  <h3 className="font-semibold text-foreground mb-2">1. Military-Grade Encryption</h3>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>AES-256-GCM:</strong> All sensitive data (OAuth tokens, session cookies, voice recordings) are encrypted at rest using AES-256-GCM, the same encryption used by governments and military organizations.</li>
                    <li><strong>TLS 1.3:</strong> All data in transit uses TLS 1.3 encryption (HTTPS) to prevent interception.</li>
                    <li><strong>Unique Encryption Keys:</strong> Each user has a unique encryption key. Even our administrators cannot decrypt your data without your key.</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">2. Secure Infrastructure</h3>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>SOC 2 Type II Certified:</strong> Hosted on Supabase (SOC 2 Type II certified) and Google Cloud Platform</li>
                    <li><strong>DDoS Protection:</strong> Cloudflare-powered DDoS mitigation and WAF (Web Application Firewall)</li>
                    <li><strong>Automated Backups:</strong> Daily encrypted backups with 30-day retention, stored in geographically distributed regions</li>
                    <li><strong>Intrusion Detection:</strong> Real-time monitoring for suspicious activity with automated alerting</li>
                    <li><strong>Penetration Testing:</strong> Quarterly security audits by third-party cybersecurity firms</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">3. Password & Credential Security</h3>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>OAuth-Only Authentication:</strong> We use official OAuth flows for Instagram and other integrations. Your passwords are never accessed or stored by audnixai.com.</li>
                    <li><strong>SMTP Credentials:</strong> Business email credentials are encrypted with AES-256-GCM</li>
                    <li><strong>Session Tokens:</strong> Encrypted with AES-256-GCM and automatically rotated every 7 days</li>
                    <li><strong>Token Revocation:</strong> You can instantly revoke all access tokens from your dashboard</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">4. Access Controls</h3>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Row-Level Security (RLS):</strong> Database policies ensure you can only access YOUR data, not other users' data</li>
                    <li><strong>Role-Based Access Control:</strong> Admin vs. user permissions strictly enforced</li>
                    <li><strong>Audit Logs:</strong> All data access is logged with timestamps and IP addresses for compliance</li>
                    <li><strong>2FA Support:</strong> Two-factor authentication available for account security</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Eye className="w-6 h-6 text-primary" />
                How We Use Your Data (Transparent Data Processing)
              </h2>
              <div className="space-y-3 text-muted-foreground">
                <p><strong>We use your information solely to provide and improve audnixai.com services:</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Process and manage your account:</strong> Authentication, subscription management, billing</li>
                  <li><strong>Enable AI automation:</strong> Generate intelligent replies, detect buying intent, handle objections</li>
                  <li><strong>Deliver voice messages:</strong> Clone your voice and send personalized voice notes</li>
                  <li><strong>Provide customer support:</strong> Respond to your requests, troubleshoot issues</li>
                  <li><strong>Send service updates:</strong> Critical security notifications, feature announcements (opt-out available)</li>
                  <li><strong>Improve AI models:</strong> Anonymized conversation data to train better AI (opt-out available)</li>
                  <li><strong>Prevent fraud:</strong> Detect suspicious activity, enforce usage limits</li>
                </ul>
                <p className="font-semibold text-foreground mt-4">We NEVER:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>❌ Sell your personal data to third parties (guaranteed by contract)</li>
                  <li>❌ Share conversation content with advertisers or data brokers</li>
                  <li>❌ Use your leads for our own marketing purposes</li>
                  <li>❌ Train AI models on your private conversations without explicit consent</li>
                  <li>❌ Access your data for any reason other than providing the service</li>
                </ul>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <UserCheck className="w-6 h-6 text-primary" />
                Your Rights (GDPR, CCPA, and Global Compliance)
              </h2>
              <div className="space-y-3 text-muted-foreground">
                <p><strong>You have complete control over your data under GDPR, CCPA, and other privacy laws:</strong></p>
                <ul className="list-disc list-inside space-y-2">
                  <li><strong>Right to Access:</strong> Request a complete copy of all data we store about you (delivered within 30 days)</li>
                  <li><strong>Right to Correction:</strong> Update or correct any inaccurate information in your account</li>
                  <li><strong>Right to Deletion:</strong> Request permanent deletion of your account and all associated data (completed within 7 days)</li>
                  <li><strong>Right to Portability:</strong> Export your data in CSV/JSON format for migration to another platform</li>
                  <li><strong>Right to Objection:</strong> Opt out of certain data processing activities (e.g., AI model training)</li>
                  <li><strong>Right to Restriction:</strong> Limit how we use your data (e.g., disable analytics)</li>
                  <li><strong>Right to Withdraw Consent:</strong> Disconnect any integration at any time without losing your account</li>
                </ul>
                <p>To exercise any of these rights, contact us at <strong className="text-primary">privacy@audnixai.com</strong> or use the data management tools in your dashboard.</p>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <FileText className="w-6 h-6 text-primary" />
                Third-Party Services & Subprocessors
              </h2>
              <div className="space-y-3 text-muted-foreground">
                <p><strong>We integrate with trusted, enterprise-grade third-party services. Each has strict data processing agreements:</strong></p>
                <ul className="list-disc list-inside space-y-2">
                  <li><strong>Stripe (USA):</strong> Payment processing - PCI-DSS Level 1 compliant. We never store credit card details. Privacy: <a href="https://stripe.com/privacy" className="text-primary hover:underline" target="_blank">stripe.com/privacy</a></li>
                  <li><strong>OpenAI (USA):</strong> AI conversation generation - Zero data retention policy (conversations deleted after processing). Privacy: <a href="https://openai.com/privacy" className="text-primary hover:underline" target="_blank">openai.com/privacy</a></li>
                  <li><strong>ElevenLabs (USA):</strong> Voice cloning technology - Encrypted storage, GDPR compliant. Privacy: <a href="https://elevenlabs.io/privacy" className="text-primary hover:underline" target="_blank">elevenlabs.io/privacy</a></li>
                  <li><strong>Supabase (USA/EU):</strong> Database and authentication - SOC 2 Type II, ISO 27001. Privacy: <a href="https://supabase.com/privacy" className="text-primary hover:underline" target="_blank">supabase.com/privacy</a></li>
                  <li><strong>Meta/Instagram (USA):</strong> Official Instagram API - Subject to Meta's privacy policies. Privacy: <a href="https://www.facebook.com/privacy/policy" className="text-primary hover:underline" target="_blank">facebook.com/privacy/policy</a></li>
                </ul>
                <p className="mt-4 text-sm bg-primary/5 p-3 rounded-lg border border-primary/20">
                  <strong>Data Processing Agreements (DPAs):</strong> We have signed DPAs with all subprocessors to ensure GDPR compliance and data security standards.
                </p>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4">Data Retention & Deletion</h2>
              <div className="space-y-3 text-muted-foreground">
                <ul className="list-disc list-inside space-y-2">
                  <li><strong>Account data:</strong> Retained while your account is active + 90 days after deletion (for legal compliance)</li>
                  <li><strong>Voice recordings:</strong> Retained until you delete them or close your account (permanent deletion within 7 days)</li>
                  <li><strong>Conversation history:</strong> Retained for 12 months or until manual deletion (whichever comes first)</li>
                  <li><strong>OAuth tokens:</strong> Automatically refreshed or deleted after 90 days of inactivity</li>
                  <li><strong>Usage analytics:</strong> Anonymized and aggregated after 30 days, retained for 24 months for product improvement</li>
                  <li><strong>Billing records:</strong> Retained for 7 years (required by law for tax/accounting purposes)</li>
                  <li><strong>Audit logs:</strong> Retained for 1 year (for security and compliance)</li>
                </ul>
                <p className="mt-4 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/30">
                  <strong className="text-emerald-400">Guaranteed Deletion:</strong> When you delete your account, all personal data is permanently removed within 30 days. We send a confirmation email once deletion is complete.
                </p>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4">Children's Privacy</h2>
              <p className="text-muted-foreground">
                Audnix is not intended for users under 18 years of age. We do not knowingly collect information from children.
                If you believe a child has provided us with personal information, please contact us immediately at <strong className="text-primary">privacy@audnixai.com</strong>
                and we will delete the account within 24 hours.
              </p>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4">International Data Transfers</h2>
              <div className="space-y-3 text-muted-foreground">
                <p>
                  audnixai.com operates globally. Your data may be transferred to and processed in countries outside your residence,
                  including the United States and European Union.
                </p>
                <p>
                  <strong>EU-US Data Transfers:</strong> We comply with the EU-US Data Privacy Framework and use Standard Contractual Clauses (SCCs)
                  approved by the European Commission for data transfers.
                </p>
                <p>
                  <strong>Data Localization:</strong> You can request that your data be stored in specific regions (EU, US) if required by local regulations.
                </p>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4">Data Breach Notification</h2>
              <div className="space-y-3 text-muted-foreground">
                <p>
                  In the unlikely event of a data breach that affects your personal information, we will:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Notify you via email within 72 hours of discovery</li>
                  <li>Report to relevant data protection authorities as required by law</li>
                  <li>Provide details of what data was affected and steps we're taking</li>
                  <li>Offer credit monitoring services if financial data was compromised</li>
                </ul>
                <p className="mt-2 text-sm">
                  <strong>Bug Bounty Program:</strong> We run a responsible disclosure program. Security researchers can report vulnerabilities at <strong>security@audnixai.com</strong>
                </p>
              </div>
            </Card>

            <Card className="p-8 border-blue-500/20 bg-blue-500/5">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <MessageSquare className="w-6 h-6 text-blue-500" />
                AI-Generated Message Data Processing
              </h2>
              <div className="space-y-4 text-muted-foreground">
                <p>
                  When you use audnixai.com to send automated messages, we process the following data:
                </p>

                <div className="bg-background/50 p-4 rounded-lg border border-blue-500/20">
                  <h3 className="font-semibold text-foreground mb-2">Data Processed for Message Generation</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><strong>Lead Information:</strong> Names, emails, phone numbers, company details, conversation history</li>
                    <li><strong>Brand Context:</strong> Your company voice, tone, industry, previous messaging patterns</li>
                    <li><strong>Conversation History:</strong> Past messages to generate contextual follow-ups</li>
                    <li><strong>Message Content:</strong> The AI-generated text/voice sent to leads (encrypted in transit and at rest)</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-2">How We Use This Data</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>To generate personalized AI messages on your behalf</li>
                    <li>To improve our AI models (with your opt-out option in Settings)</li>
                    <li>To maintain an audit trail for compliance and dispute resolution</li>
                    <li>To detect abuse, spam, or regulatory violations</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-2">Lead Data You Import</h3>
                  <p className="text-sm">
                    <strong>You are responsible for:</strong>
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm ml-4">
                    <li>Ensuring you have legal permission to contact all imported leads</li>
                    <li>Obtaining consent where required by law (GDPR, CCPA, etc.)</li>
                    <li>Complying with anti-spam regulations (CAN-SPAM, GDPR, TCPA)</li>
                    <li>Deleting lead data when requested (we honor deletion requests)</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-2">AI Training & Privacy</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>By default, we DO NOT use your message content to train AI models</li>
                    <li>You can opt-in to AI training improvements in Settings → Privacy → AI Training</li>
                    <li>All training data is anonymized and cannot be re-identified</li>
                    <li>You can opt-out at any time, and we delete training data within 30 days</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4">Changes to This Policy</h2>
              <p className="text-muted-foreground">
                We may update this Privacy Policy periodically to reflect changes in our practices, technology, or legal requirements.
                We will notify you of significant changes via email at least <strong>30 days before</strong> they take effect.
                Your continued use of audnixai.com after changes constitutes acceptance of the updated policy.
              </p>
              <p className="text-muted-foreground mt-2">
                <strong>Version History:</strong> All previous versions are archived and available upon request.
              </p>
            </Card>

            <Card className="p-8">
              <h2 className="text-2xl font-bold mb-4">Your Consent & Control</h2>
              <div className="space-y-3 text-muted-foreground">
                <p>
                  <strong>By using audnixai.com, you consent to this Privacy Policy.</strong> However, you can:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>✅ Disconnect any integration at any time (Settings → Integrations)</li>
                  <li>✅ Delete your voice recordings (Settings → Voice)</li>
                  <li>✅ Opt out of analytics and AI training (Settings → Privacy)</li>
                  <li>✅ Export your data (Settings → Data & Privacy → Export)</li>
                  <li>✅ Delete your account permanently (Settings → Account → Delete Account)</li>
                </ul>
                <p className="mt-4 text-sm bg-primary/5 p-3 rounded-lg border border-primary/20">
                  <strong>Granular Controls:</strong> Unlike most SaaS tools, we give you per-feature privacy controls. Turn off what you don't need.
                </p>
              </div>
            </Card>

            <Card className="p-8 bg-primary/5 border-primary/20">
              <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
              <p className="text-muted-foreground mb-4">
                If you have questions about this Privacy Policy, how we handle your data, or want to exercise your rights:
              </p>
              <ul className="space-y-2 text-muted-foreground">
                <li><strong>Privacy Inquiries:</strong> <a href="mailto:privacy@audnixai.com" className="text-primary hover:underline">privacy@audnixai.com</a></li>
                <li><strong>Data Protection Officer:</strong> <a href="mailto:dpo@audnixai.com" className="text-primary hover:underline">dpo@audnixai.com</a></li>
                <li><strong>Security Reports:</strong> <a href="mailto:security@audnixai.com" className="text-primary hover:underline">security@audnixai.com</a></li>
                <li><strong>General Support:</strong> <a href="mailto:support@audnixai.com" className="text-primary hover:underline">support@audnixai.com</a></li>
                <li><strong>Mailing Address:</strong> audnixai.com, Inc., 251 18th Street, 7th Floor, New York, NY 10011, USA</li>
              </ul>
              <p className="text-muted-foreground mt-4">
                <strong>Response Time:</strong> We respond to privacy requests within 48 hours (business days).
              </p>
            </Card>
          </motion.div>

          {/* Back to Home */}
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

