import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, Key, Server, BookOpen, Copy, Check } from "lucide-react";

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
  items: EndpointItem[];
}

const API_ENDPOINTS: EndpointSection[] = [
  {
    section: "Authentication",
    items: [
      { method: "POST", path: "/api/auth/login", desc: "Login with email and password", auth: "None", body: { email: "string", password: "string" } },
      { method: "POST", path: "/api/auth/signup/request-otp", desc: "Request OTP for signup", auth: "None", body: { email: "string" } },
      { method: "POST", path: "/api/auth/signup/verify-otp", desc: "Verify OTP and create account", auth: "None", body: { email: "string", otp: "string" } },
      { method: "POST", path: "/api/auth/logout", desc: "End current session", auth: "Session" },
      { method: "GET", path: "/api/auth/me", desc: "Get current authenticated user", auth: "Session | API Key" },
    ],
  },
  {
    section: "Leads",
    items: [
      { method: "GET", path: "/api/leads", desc: "List all leads with filters", auth: "Session | API Key", params: { status: "string (optional)", limit: "number (optional)", offset: "number (optional)" } },
      { method: "GET", path: "/api/leads/:id", desc: "Get single lead details", auth: "Session | API Key" },
      { method: "POST", path: "/api/leads/:leadId/research", desc: "Trigger AI research on a lead", auth: "Session | API Key" },
      { method: "POST", path: "/api/leads/reply/:leadId", desc: "Generate AI reply for a lead", auth: "Session | API Key" },
      { method: "POST", path: "/api/leads/intelligence/score", desc: "AI score lead quality", auth: "Session | API Key" },
      { method: "POST", path: "/api/leads/import-csv", desc: "Bulk import leads from CSV", auth: "Session" },
    ],
  },
  {
    section: "Campaigns & Outreach",
    items: [
      { method: "GET", path: "/api/outreach/campaigns", desc: "List all campaigns", auth: "Session | API Key" },
      { method: "POST", path: "/api/outreach/campaigns", desc: "Create a new campaign", auth: "Session", body: { name: "string", subject: "string", content: "string", targets: "object" } },
      { method: "POST", path: "/api/outreach/campaigns/:id/start", desc: "Start campaign execution", auth: "Session" },
      { method: "POST", path: "/api/outreach/campaigns/:id/pause", desc: "Pause active campaign", auth: "Session" },
      { method: "POST", path: "/api/outreach/campaigns/:id/abort", desc: "Abort campaign immediately", auth: "Session" },
    ],
  },
  {
    section: "Dashboard & Analytics",
    items: [
      { method: "GET", path: "/api/dashboard/stats", desc: "Get dashboard statistics", auth: "Session | API Key" },
      { method: "GET", path: "/api/dashboard/activity", desc: "Get recent activity feed", auth: "Session | API Key" },
      { method: "GET", path: "/api/dashboard/analytics/full", desc: "Full analytics report", auth: "Session | API Key" },
      { method: "GET", path: "/api/stats/inbox-placement", desc: "Inbox vs spam placement stats", auth: "Session | API Key", params: { days: "number (default: 30)" } },
      { method: "GET", path: "/api/stats/domain-reputation", desc: "Per-mailbox domain reputation", auth: "Session | API Key", params: { days: "number (default: 30)" } },
      { method: "GET", path: "/api/stats/bounces/stats", desc: "Bounce statistics", auth: "Session | API Key" },
      { method: "GET", path: "/api/stats/warmup/status", desc: "Email warmup status", auth: "Session | API Key" },
    ],
  },
  {
    section: "Integrations",
    items: [
      { method: "GET", path: "/api/custom-email/status", desc: "Email connection status", auth: "Session | API Key" },
      { method: "GET", path: "/api/integrations", desc: "List all connected integrations", auth: "Session | API Key" },
      { method: "POST", path: "/api/custom-email/connect", desc: "Connect custom SMTP email", auth: "Session" },
      { method: "POST", path: "/api/custom-email/test", desc: "Test SMTP connection", auth: "Session" },
      { method: "POST", path: "/api/custom-email/sync-now", desc: "Trigger email sync", auth: "Session" },
    ],
  },
  {
    section: "Messages & Conversations",
    items: [
      { method: "GET", path: "/api/messages/:leadId", desc: "Get conversation with a lead", auth: "Session | API Key" },
      { method: "POST", path: "/api/messages/:leadId", desc: "Send a message to a lead", auth: "Session | API Key", body: { content: "string" } },
    ],
  },
  {
    section: "Deals & Pipeline",
    items: [
      { method: "GET", path: "/api/deals", desc: "List all deals in pipeline", auth: "Session | API Key" },
      { method: "POST", path: "/api/deals", desc: "Create a new deal", auth: "Session" },
    ],
  },
  {
    section: "Calendar",
    items: [
      { method: "GET", path: "/api/calendar", desc: "Get calendar bookings", auth: "Session | API Key" },
      { method: "GET", path: "/api/calendar/slots", desc: "Get available calendar slots", auth: "Session | API Key" },
    ],
  },
  {
    section: "Notifications",
    items: [
      { method: "GET", path: "/api/notifications", desc: "List notifications", auth: "Session | API Key" },
      { method: "POST", path: "/api/notifications/mark-all-read", desc: "Mark all notifications read", auth: "Session" },
    ],
  },
  {
    section: "Developer",
    items: [
      { method: "GET", path: "/api/mcp/keys", desc: "List your API keys", auth: "Session" },
      { method: "POST", path: "/api/mcp/key/create", desc: "Create a new API key", auth: "Session", body: { name: "string", permission_level: "'read' | 'read_write'" } },
      { method: "DELETE", path: "/api/mcp/key/:id", desc: "Delete an API key", auth: "Session" },
      { method: "POST", path: "/mcp", desc: "MCP endpoint — list tools, call tools", auth: "API Key" },
      { method: "DELETE", path: "/api/account", desc: "Delete account — blocked for API keys", auth: "Session only" },
      { method: "POST", path: "/api/auth/signup/request-otp", desc: "Request OTP — restricted for API keys", auth: "Session only" },
    ],
  },
];

const SECTIONS = API_ENDPOINTS.map(s => s.section);

const methodColors: Record<string, string> = {
  GET: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  POST: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  PATCH: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  PUT: "text-orange-500 bg-orange-500/10 border-orange-500/20",
  DELETE: "text-red-500 bg-red-500/10 border-red-500/20",
};

export default function DeveloperDocsPage() {
  const [activeSection, setActiveSection] = useState("Authentication");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredSections = API_ENDPOINTS.map(s => ({
    ...s,
    items: s.items.filter(
      i =>
        i.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.method.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(s => s.items.length > 0);

  const currentSection = filteredSections.find(s => s.section === activeSection) || filteredSections[0];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center">
                <div className="w-3.5 h-3.5 bg-primary rounded-sm rotate-45" />
              </div>
              <span className="font-bold text-sm">Audnix</span>
            </a>
            <div className="h-4 w-px bg-border" />
            <span className="text-xs font-medium text-muted-foreground">API Docs</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search endpoints..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-3 text-xs w-48"
              />
            </div>
            <a
              href="/dashboard/developer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-primary text-primary-foreground text-xs font-medium"
            >
              <Key className="h-3.5 w-3.5" />
              API Keys
            </a>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-1.5 text-muted-foreground hover:text-foreground"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto flex">
        <aside className={`${sidebarOpen ? "fixed inset-0 z-40 bg-background" : "hidden"} md:block md:w-56 lg:w-64 border-r shrink-0`}>
          <nav className={`${sidebarOpen ? "p-4" : "sticky top-14 p-3"} max-h-[calc(100vh-3.5rem)] overflow-y-auto`}>
            {sidebarOpen && (
              <div className="mb-4">
                <Input
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            )}
            <div className="space-y-0.5">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Endpoints</div>
              {SECTIONS.map(section => (
                <button
                  key={section}
                  onClick={() => { setActiveSection(section); setSidebarOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                    activeSection === section
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {section}
                </button>
              ))}
            </div>
            <div className="mt-6 pt-4 border-t space-y-1">
              <a href="/dashboard/developer" className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <Key className="h-3.5 w-3.5" />
                API Keys
              </a>
              <a href="/dashboard/mcp-server" className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <Server className="h-3.5 w-3.5" />
                MCP Server
              </a>
              <a href="/dashboard/settings" className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <BookOpen className="h-3.5 w-3.5" />
                Dashboard
              </a>
            </div>
          </nav>
        </aside>

        <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8">
          <div className="max-w-3xl">
            <div className="mb-6">
        <h1 className="text-xl font-bold">API Reference</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Authenticate with <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">Authorization: Bearer audnix_...</code>
        </p>
      </div>

            {currentSection && (
              <div>
                <h2 className="text-base font-semibold mb-3">{currentSection.section}</h2>
                <div className="space-y-2">
                  {currentSection.items.map(item => (
                    <div key={item.path} className="border rounded-lg p-3 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-3">
                        <Badge variant="outline" className={`text-[10px] font-mono px-1.5 py-0 border shrink-0 mt-0.5 ${methodColors[item.method] || "text-gray-500 bg-gray-500/10"}`}>
                          {item.method}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono break-all">{item.path}</code>
                            <button
                              onClick={() => copy(item.path, item.path)}
                              className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-all"
                            >
                              {copied === item.path ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            <span className="text-[10px] text-muted-foreground/60 font-mono">{item.auth}</span>
                            {item.params && Object.keys(item.params).length > 0 && (
                              <span className="text-[10px] text-muted-foreground/60">
                                params: {Object.entries(item.params).map(([k, v]) => `${k}: ${v}`).join(", ")}
                              </span>
                            )}
                            {item.body && Object.keys(item.body).length > 0 && (
                              <span className="text-[10px] text-muted-foreground/60">
                                body: {Object.entries(item.body).map(([k, v]) => `${k}: ${v}`).join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredSections.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">No endpoints match your search.</p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
