import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Key,
  Terminal,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Server,
  Code,
  Shield,
  Zap,
  BarChart3,
  Mail,
  Users,
  Globe,
  Lock,
  ArrowRight,
  Menu,
  X,
  Search,
} from "lucide-react";

interface EndpointItem {
  method: string;
  path: string;
  desc: string;
  auth: string;
  params?: Record<string, string>;
  body?: Record<string, string>;
}
interface EndpointSection {
  section: string;
  icon?: any;
  items: EndpointItem[];
}

const API_ENDPOINTS: EndpointSection[] = [
  {
    section: "Authentication",
    items: [
      {
        method: "POST",
        path: "/api/auth/login",
        desc: "Login with email and password",
        auth: "Session",
        body: { email: "string", password: "string" },
      },
      {
        method: "POST",
        path: "/api/auth/signup/request-otp",
        desc: "Request OTP for signup",
        auth: "None",
        body: { email: "string" },
      },
      {
        method: "POST",
        path: "/api/auth/signup/verify-otp",
        desc: "Verify OTP and create account",
        auth: "None",
        body: { email: "string", otp: "string" },
      },
      {
        method: "POST",
        path: "/api/auth/logout",
        desc: "End current session",
        auth: "Session",
      },
      {
        method: "GET",
        path: "/api/auth/me",
        desc: "Get current authenticated user",
        auth: "Session | API Key",
      },
    ],
  },
  {
    section: "Leads",
    icon: Users,
    items: [
      {
        method: "GET",
        path: "/api/leads",
        desc: "List all leads with filters",
        auth: "Session | API Key",
        params: { status: "string (optional)", limit: "number (optional)", offset: "number (optional)" },
      },
      {
        method: "GET",
        path: "/api/leads/:id",
        desc: "Get single lead details",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/leads/:leadId/research",
        desc: "Trigger AI research on a lead",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/leads/reply/:leadId",
        desc: "Generate AI reply for a lead",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/leads/intelligence/score",
        desc: "AI score lead quality",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/leads/import-csv",
        desc: "Bulk import leads from CSV",
        auth: "Session",
      },
    ],
  },
  {
    section: "Campaigns & Outreach",
    icon: Mail,
    items: [
      {
        method: "GET",
        path: "/api/outreach/campaigns",
        desc: "List all campaigns",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/outreach/campaigns",
        desc: "Create a new campaign",
        auth: "Session",
        body: { name: "string", subject: "string", content: "string", targets: "object" },
      },
      {
        method: "POST",
        path: "/api/outreach/campaigns/:id/start",
        desc: "Start campaign execution",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/outreach/campaigns/:id/pause",
        desc: "Pause active campaign",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/outreach/campaigns/:id/abort",
        desc: "Abort campaign immediately",
        auth: "Session",
      },
    ],
  },
  {
    section: "Dashboard & Analytics",
    icon: BarChart3,
    items: [
      {
        method: "GET",
        path: "/api/dashboard/stats",
        desc: "Get dashboard statistics",
        auth: "Session | API Key",
      },
      {
        method: "GET",
        path: "/api/dashboard/activity",
        desc: "Get recent activity feed",
        auth: "Session | API Key",
      },
      {
        method: "GET",
        path: "/api/dashboard/analytics/full",
        desc: "Full analytics report",
        auth: "Session | API Key",
      },
      {
        method: "GET",
        path: "/api/stats/inbox-placement",
        desc: "Inbox vs spam placement stats",
        auth: "Session | API Key",
        params: { days: "number (default: 30)", integrationId: "string (optional)" },
      },
      {
        method: "GET",
        path: "/api/stats/domain-reputation",
        desc: "Per-mailbox domain reputation",
        auth: "Session | API Key",
        params: { days: "number (default: 30)" },
      },
      {
        method: "GET",
        path: "/api/stats/bounces/stats",
        desc: "Bounce statistics",
        auth: "Session | API Key",
      },
      {
        method: "GET",
        path: "/api/stats/warmup/status",
        desc: "Email warmup status",
        auth: "Session | API Key",
      },
    ],
  },
  {
    section: "Integrations",
    icon: Globe,
    items: [
      {
        method: "GET",
        path: "/api/custom-email/status",
        desc: "Email connection status",
        auth: "Session | API Key",
      },
      {
        method: "GET",
        path: "/api/integrations",
        desc: "List all connected integrations",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/custom-email/connect",
        desc: "Connect custom SMTP email",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/custom-email/test",
        desc: "Test SMTP connection",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/custom-email/sync-now",
        desc: "Trigger email sync",
        auth: "Session",
      },
    ],
  },
  {
    section: "Messages & Conversations",
    icon: Mail,
    items: [
      {
        method: "GET",
        path: "/api/messages/:leadId",
        desc: "Get conversation with a lead",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/messages/:leadId",
        desc: "Send a message to a lead",
        auth: "Session | API Key",
        body: { content: "string" },
      },
    ],
  },
  {
    section: "Deals & Pipeline",
    icon: BarChart3,
    items: [
      {
        method: "GET",
        path: "/api/deals",
        desc: "List all deals in pipeline",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/deals",
        desc: "Create a new deal",
        auth: "Session",
      },
    ],
  },
  {
    section: "Calendar",
    icon: Zap,
    items: [
      {
        method: "GET",
        path: "/api/calendar",
        desc: "Get calendar bookings",
        auth: "Session | API Key",
      },
      {
        method: "GET",
        path: "/api/calendar/slots",
        desc: "Get available calendar slots",
        auth: "Session | API Key",
      },
    ],
  },
  {
    section: "Notifications",
    icon: Zap,
    items: [
      {
        method: "GET",
        path: "/api/notifications",
        desc: "List notifications",
        auth: "Session | API Key",
      },
      {
        method: "POST",
        path: "/api/notifications/mark-all-read",
        desc: "Mark all notifications read",
        auth: "Session",
      },
    ],
  },
  {
    section: "Developer",
    icon: Key,
    items: [
      {
        method: "GET",
        path: "/api/developer/api-keys",
        desc: "List your API keys (truncated)",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/developer/api-keys",
        desc: "Create a new API key",
        auth: "Session",
        body: { name: "string", scope: "'read_only' | 'read_write' (optional)" },
      },
      {
        method: "PATCH",
        path: "/api/developer/api-keys/:id",
        desc: "Edit API key name",
        auth: "Session",
        body: { name: "string" },
      },
      {
        method: "DELETE",
        path: "/api/developer/api-keys/:id",
        desc: "Delete/revoke an API key",
        auth: "Session",
      },
      {
        method: "GET",
        path: "/api/developer/api-keys/:id/security",
        desc: "Check key for exposure",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/developer/request-deletion",
        desc: "Request account deletion (24-48h delay)",
        auth: "Session",
      },
      {
        method: "POST",
        path: "/api/developer/cancel-deletion",
        desc: "Cancel pending account deletion",
        auth: "Session",
      },
      {
        method: "GET",
        path: "/api/developer/deletion-status",
        desc: "Check pending deletion status",
        auth: "Session",
      },
    ],
  },
];

const SECTIONS = API_ENDPOINTS.map((s) => s.section);

export default function DeveloperDocsPage() {
  const [activeSection, setActiveSection] = useState("Authentication");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    document.title = "AUDNIX — Developer API Documentation";
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredSections = API_ENDPOINTS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.method.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/20 bg-background/80 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <div className="w-4 h-4 bg-primary rounded-sm rotate-45" />
              </div>
              <span className="font-bold text-lg tracking-tight hidden sm:block">AUDNIX</span>
            </a>
            <div className="h-5 w-px bg-border/40 hidden sm:block" />
            <span className="text-sm font-bold text-primary hidden sm:block">Developer Docs</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search endpoints..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-9 pr-4 rounded-xl bg-muted/50 border border-border/30 text-xs font-medium w-56 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
              />
            </div>
            <a
              href="/dashboard/settings?tab=developer"
              className="hidden sm:inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-colors"
            >
              <Key className="h-3.5 w-3.5" />
              Get API Key
            </a>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-muted-foreground hover:text-foreground"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto flex">
        {/* Sidebar */}
        <aside className={`${mobileMenuOpen ? "fixed inset-0 z-40" : "hidden"} md:block md:w-64 lg:w-72 border-r border-border/20 bg-muted/10 shrink-0`}>
          <nav className={`${mobileMenuOpen ? "h-full overflow-y-auto p-6 bg-background" : "sticky top-16 p-4 overflow-y-auto"} max-h-[calc(100vh-4rem)]`}>
            {mobileMenuOpen && (
              <div className="mb-6">
                <input
                  type="text"
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl bg-muted/50 border border-border/30 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}
            <div className="space-y-1">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Endpoints
              </div>
              {SECTIONS.map((section) => (
                <button
                  key={section}
                  onClick={() => {
                    setActiveSection(section);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                    activeSection === section
                      ? "bg-primary/10 text-primary font-bold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  {section}
                </button>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-border/20 space-y-3">
              <a
                href="/dashboard/settings?tab=developer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 text-primary font-bold text-sm hover:bg-primary/20 transition-colors"
              >
                <Key className="h-4 w-4" />
                Get API Key
              </a>
              <a
                href="/dashboard/settings?tab=developer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30 text-sm font-medium transition-colors"
              >
                <Server className="h-4 w-4" />
                MCP Server
              </a>
              <a
                href="https://github.com/audnixai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30 text-sm font-medium transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                GitHub
              </a>
            </div>
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl">
            {/* Hero */}
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="sys-tag text-primary">API v1</span>
                <span className="text-xs text-muted-foreground">Stable</span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
                Audnix API
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
                Build on top of Audnix's autonomous sales engine. Access leads, campaigns, analytics, and more
                programmatically using your API key.
              </p>
            </div>

            {/* Authentication Info */}
            <div className="p-6 bg-gradient-to-br from-primary/5 to-purple-500/5 rounded-2xl border border-primary/15 mb-10">
              <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                Authentication
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  All API endpoints accept authentication via session cookie (browser) or <code className="text-primary font-mono text-xs bg-primary/10 px-1.5 py-0.5 rounded">Authorization: Bearer</code> header (curl/scripts).
                </p>
                <div className="p-4 bg-background/50 rounded-xl border border-border/30">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Using an API Key</p>
                  <code className="text-xs font-mono block">curl -H "Authorization: Bearer audnix_your_key_here" \
  https://audnixai.com/api/leads</code>
                </div>
                <div className="flex items-start gap-3 p-4 bg-amber-500/5 rounded-xl border border-amber-500/10">
                  <Shield className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-foreground text-xs uppercase tracking-wider mb-1">Security Note</p>
                    <p className="text-xs">
                      API keys are tied to your account. Never share them or commit them to public repositories.
                      If exposed, revoke immediately from Settings → Developer.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Curl Examples Gallery */}
            <div className="mb-10">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Terminal className="h-5 w-5 text-primary" />
                Curl Examples
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/leads?limit=5`, desc: "List your 5 most recent leads", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/leads?status=warm`, desc: "Query warm leads only", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/outreach/campaigns`, desc: "Get all campaign stats", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/dashboard/stats`, desc: "Dashboard analytics overview", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/stats/inbox-placement?days=7`, desc: "Last 7 days inbox placement", method: "GET" },
                  { cmd: `curl -X POST \\\n  -H "Authorization: Bearer audnix_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"content":"Follow up on our last email"}' \\\n  https://audnixai.com/api/messages/LEAD_ID`, desc: "Send a message to a lead", method: "POST" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/deals`, desc: "View pipeline deals", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/notifications`, desc: "Check recent notifications", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/stats/warmup/status`, desc: "Warmup status for all mailboxes", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/stats/domain-reputation?days=30`, desc: "30-day domain reputation scores", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/integrations`, desc: "List all connected integrations", method: "GET" },
                  { cmd: `curl -H "Authorization: Bearer audnix_..." \\\n  https://audnixai.com/api/calendar/bookings`, desc: "Calendar bookings & meetings", method: "GET" },
                ].map((example) => (
                  <div key={example.desc} className="p-4 bg-muted/5 rounded-xl border border-border/20 hover:border-border/40 transition-all group">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                        example.method === 'GET' ? 'text-emerald-500 bg-emerald-500/10' : 'text-blue-500 bg-blue-500/10'
                      }`}>{example.method}</span>
                      <span className="text-[11px] text-muted-foreground flex-1">{example.desc}</span>
                      <button
                        onClick={() => copyToClipboard(example.cmd, example.desc)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted/50"
                      >
                        {copied === example.desc ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                      </button>
                    </div>
                    <code className="text-[10px] font-mono block whitespace-pre-wrap text-muted-foreground/70 leading-relaxed">{example.cmd}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* API Key Format */}
            <div className="mb-10">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                API Key Format
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: "Prefix", value: "audnix_", desc: "Branded prefix like OpenAI's sk-" },
                  { label: "Length", value: "71 characters", desc: "audnix_ + 64 hex chars (256 bits)" },
                  { label: "Storage", value: "SHA-256 hash", desc: "Never stored in plaintext" },
                  { label: "Rate Limit", value: "60 req/min", desc: "Per-key rate limiting" },
                  { label: "Permissions", value: "Read or Read/Write", desc: "Set at creation time" },
                  { label: "Revocation", value: "Instant", desc: "Delete from dashboard → immediate" },
                ].map((item) => (
                  <div key={item.label} className="p-4 bg-muted/10 rounded-xl border border-border/20">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{item.label}</p>
                    <p className="font-bold text-sm">{item.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rate Limiting */}
            <div className="mb-10 p-6 bg-muted/10 rounded-2xl border border-border/20">
              <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Rate Limiting
              </h2>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { limiter: "General API", limit: "1,000 requests", window: "per 15 min" },
                    { limiter: "API Key (per key)", limit: "60 requests", window: "per 1 min" },
                    { limiter: "Auth", limit: "100 requests", window: "per 15 min" },
                    { limiter: "AI Generation", limit: "20 requests", window: "per 1 min" },
                    { limiter: "Developer API", limit: "30 requests", window: "per 15 min" },
                    { limiter: "Email Sending", limit: "300 requests", window: "per 1 hour" },
                  ].map((item) => (
                    <div key={item.limiter} className="p-3 bg-background/50 rounded-xl border border-border/20">
                      <p className="font-bold text-xs">{item.limiter}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.limit} {item.window}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground/60 mt-3">
                  Rate limits apply per-user or per-IP. Redis-backed. Headers <code className="text-xs font-mono">RateLimit-Remaining</code> and <code className="text-xs font-mono">RateLimit-Reset</code> are returned on every response.
                </p>
              </div>
            </div>

            {/* Endpoints */}
            {filteredSections.map((section) => (
              <div key={section.section} id={section.section.toLowerCase().replace(/\s+/g, "-")} className="mb-12 scroll-mt-20">
                <div className="flex items-center gap-2 mb-6">
                  <div className="h-6 w-1 rounded-full bg-primary" />
                  <h2 className="text-xl font-bold">{section.section}</h2>
                </div>
                <div className="space-y-3">
                  {section.items.map((endpoint) => {
                    const methodColor =
                      endpoint.method === "GET"
                        ? "text-emerald-500 bg-emerald-500/10"
                        : endpoint.method === "POST"
                        ? "text-blue-500 bg-blue-500/10"
                        : endpoint.method === "PATCH"
                        ? "text-amber-500 bg-amber-500/10"
                        : endpoint.method === "DELETE"
                        ? "text-red-500 bg-red-500/10"
                        : "text-muted-foreground bg-muted/20";

                    return (
                      <motion.div
                        key={endpoint.path}
                        initial={{ opacity: 0, y: 10 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="p-4 bg-muted/5 rounded-xl border border-border/20 hover:border-border/40 transition-all group"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${methodColor}`}>
                                {endpoint.method}
                              </span>
                              <code className="text-xs sm:text-sm font-mono font-bold text-foreground break-all">{endpoint.path}</code>
                              {endpoint.auth?.includes("API Key") && (
                                <span className="text-[9px] text-primary/60 font-bold uppercase tracking-wider shrink-0">🔑 Key</span>
                              )}
                            </div>
                            <p className="text-xs sm:text-sm text-muted-foreground">{endpoint.desc}</p>
                            {endpoint.params && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {Object.entries(endpoint.params).map(([key, val]) => (
                                  <span key={key} className="text-[9px] font-mono bg-muted/30 px-1.5 py-0.5 rounded text-muted-foreground/70">
                                    {key}: {String(val)}
                                  </span>
                                ))}
                              </div>
                            )}
                            {endpoint.body && (
                              <details className="mt-2">
                                <summary className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 cursor-pointer hover:text-foreground">
                                  Request Body
                                </summary>
                                <pre className="mt-2 p-3 bg-muted/20 rounded-lg text-[10px] font-mono overflow-x-auto">
                                  {JSON.stringify(endpoint.body, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                `curl -H "Authorization: Bearer audnix_..." ${endpoint.method === "GET" ? "" : `-X ${endpoint.method} `}https://audnixai.com${endpoint.path}`,
                                endpoint.path
                              )
                            }
                            className="shrink-0 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-muted/50 transition-all"
                            title="Copy curl command"
                          >
                            {copied === endpoint.path ? (
                              <Check className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <Copy className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* MCP Section */}
            <div className="mb-12">
              <div className="flex items-center gap-2 mb-6">
                <div className="h-6 w-1 rounded-full bg-primary" />
                <h2 className="text-xl font-bold">MCP Server</h2>
              </div>

              {/* Intro */}
              <div className="p-6 bg-gradient-to-br from-primary/5 to-purple-500/5 rounded-2xl border border-primary/15 space-y-4 mb-6">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Connect any LLM agent via the Model Context Protocol (MCP). Works with Claude Desktop,
                  Cursor, VS Code extensions, custom chatbots, and any MCP-compatible client.
                </p>

                {/* LLM Provider Logos */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mr-1">Compatible with:</span>
                  {[
                    { name: "Claude", bg: "bg-[#d97706]/10", text: "text-[#d97706]", icon: "Cl" },
                    { name: "Gemini", bg: "bg-[#4285F4]/10", text: "text-[#4285F4]", icon: "Ge" },
                    { name: "ChatGPT", bg: "bg-[#10a37f]/10", text: "text-[#10a37f]", icon: "G" },
                    { name: "Cursor", bg: "bg-[#6c47ff]/10", text: "text-[#6c47ff]", icon: "Cu" },
                    { name: "Copilot", bg: "bg-[#0078d4]/10", text: "text-[#0078d4]", icon: "Cp" },
                    { name: "Cline", bg: "bg-[#f97316]/10", text: "text-[#f97316]", icon: "Cl" },
                    { name: "Continue", bg: "bg-[#7c3aed]/10", text: "text-[#7c3aed]", icon: "Co" },
                    { name: "OpenCode", bg: "bg-[#06b6d4]/10", text: "text-primary", icon: "OC" },
                  ].map((llm) => (
                    <div key={llm.name} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/30 ${llm.bg}`}>
                      <span className={`text-[9px] font-black uppercase ${llm.text}`}>{llm.icon}</span>
                      <span className="text-[10px] font-bold text-muted-foreground">{llm.name}</span>
                    </div>
                  ))}
                </div>

                {/* Config */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  <div className="p-4 bg-background/50 rounded-xl border border-border/30">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Claude Desktop</p>
                    <code className="text-[10px] font-mono block whitespace-pre-wrap text-foreground">{`{
  "mcpServers": {
    "audnix": {
      "url": "https://audnixai.com/api/mcp",
      "headers": {
        "Authorization": "Bearer audnix_your_api_key"
      }
    }
  }
}`}</code>
                  </div>
                  <div className="p-4 bg-background/50 rounded-xl border border-border/30">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">VS Code / Cursor</p>
                    <code className="text-[10px] font-mono block whitespace-pre-wrap text-foreground">{`{
  "mcp": {
    "inputs": [],
    "servers": {
      "audnix": {
        "url": "https://audnixai.com/api/mcp",
        "headers": {
          "Authorization": "Bearer audnix_your_api_key"
        }
      }
    }
  }
}`}</code>
                  </div>
                </div>
              </div>

              {/* Available Tools */}
              <div className="mb-6">
                <h3 className="font-bold text-base mb-4 flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  Available Tools
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { tool: "get_leads", desc: "Query leads by status, date, category", danger: false },
                    { tool: "get_campaigns", desc: "List campaigns and performance", danger: false },
                    { tool: "get_analytics", desc: "Retrieve dashboard analytics", danger: false },
                    { tool: "get_inbox", desc: "Read inbox messages and threads", danger: false },
                    { tool: "send_message", desc: "Send outreach via connected mailboxes", danger: true },
                    { tool: "manage_webhooks", desc: "Create and manage webhook endpoints", danger: true },
                  ].map((tool) => (
                    <div key={tool.tool} className="flex items-start gap-3 p-3 bg-muted/5 rounded-xl border border-border/20 hover:border-border/40 transition-all">
                      <div className="p-1.5 rounded-lg bg-primary/10 mt-0.5 shrink-0">
                        <Terminal className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-bold font-mono text-foreground">{tool.tool}</code>
                          {tool.danger && (
                            <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              ⚠️ Confirm
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{tool.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Permissions & Scope */}
              <div className="p-6 bg-muted/10 rounded-2xl border border-border/20 space-y-4">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Permissions & Safety
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/20">
                        <th className="text-left font-bold uppercase tracking-wider text-muted-foreground p-2">Scope</th>
                        <th className="text-left font-bold uppercase tracking-wider text-muted-foreground p-2">Read</th>
                        <th className="text-left font-bold uppercase tracking-wider text-muted-foreground p-2">Write</th>
                        <th className="text-left font-bold uppercase tracking-wider text-muted-foreground p-2">Cannot Do</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/10">
                        <td className="p-2 font-bold">read_only</td>
                        <td className="p-2 text-emerald-500">Leads, campaigns, analytics, inbox, integrations</td>
                        <td className="p-2 text-muted-foreground/50">—</td>
                        <td className="p-2 text-muted-foreground">Send messages, modify data, delete</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold">read_write</td>
                        <td className="p-2 text-emerald-500">Everything</td>
                        <td className="p-2 text-emerald-500">Send messages, campaigns, webhooks, leads</td>
                        <td className="p-2 text-destructive">Delete account, access auth, billing, other users</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex items-start gap-3 p-4 bg-amber-500/5 rounded-xl border border-amber-500/10">
                  <Shield className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-foreground text-xs uppercase tracking-wider mb-1">Dangerous Operations</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <code className="text-[10px] font-mono bg-muted/50 px-1 rounded">send_message</code> sends real emails/DMs — ALWAYS show content to user first.
                      Deleting leads or modifying active campaigns requires explicit user confirmation.
                      Auth endpoints, account deletion, and billing are never accessible via API key.
                      A skill file (<code className="text-[10px] font-mono bg-muted/50 px-1 rounded">audnix-mcp.skill.md</code>) is available for LLM agents to understand these rules automatically.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="py-8 border-t border-border/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                AUDNIX API v1.0 — Documentation last updated July 2026
              </p>
              <div className="flex items-center gap-4">
                <a href="/dashboard/settings?tab=developer" className="text-xs font-bold text-primary hover:underline">
                  <Key className="h-3.5 w-3.5 inline mr-1" />
                  Get API Key
                </a>
                <a href="/" className="text-xs text-muted-foreground hover:text-foreground">
                  ← Back to Home
                </a>
              </div>
            </div>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
