import { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  Terminal, Copy, Check, Play, Server, Search, ArrowUpRight,
  Sparkles, Cpu, Workflow, Puzzle, Heart, Radius, FileCode,
} from "lucide-react";
import {
  SiClaude, SiCursor, SiWindsurf, SiCline, SiGithubcopilot,
  SiGooglegemini, SiWarp, SiMintlify, SiVercel, SiReplit,
  SiCodesandbox, SiStackblitz, SiGitpod, SiJetbrains,
  SiAnthropic, SiXcode, SiIntellijidea,
  SiAndroidstudio, SiPycharm, SiNeovim, SiSublimetext,
} from "react-icons/si";
import { PageWrapper } from "@/components/ui/page-wrapper";

const ic = "h-4 w-4 shrink-0";

type LlmEntry = {
  id: string; name: string; docsUrl: string;
  icon: React.ReactNode; color: string; sub?: string;
};

const LLM_TABS: LlmEntry[] = [
  { id: "claude", name: "Claude", sub: "Anthropic", docsUrl: "https://docs.anthropic.com/en/docs/claude-integrations", icon: <span className="flex -space-x-1"><SiClaude className={`${ic} text-orange-400`} /><SiAnthropic className={`${ic} text-orange-300`} /></span>, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "cursor", name: "Cursor", docsUrl: "https://docs.cursor.com/get-started/mcp", icon: <SiCursor className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "windsurf", name: "Windsurf", docsUrl: "https://codeium.com/windsurf", icon: <SiWindsurf className={`${ic} text-cyan-400`} />, color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { id: "cline", name: "Cline", docsUrl: "https://github.com/nicepkg/Cline", icon: <SiCline className={`${ic} text-violet-400`} />, color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  { id: "openai", name: "OpenAI", docsUrl: "https://platform.openai.com/docs", icon: <Sparkles className={`${ic} text-emerald-400`} />, color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { id: "github-copilot", name: "Copilot", docsUrl: "https://docs.github.com/en/copilot", icon: <SiGithubcopilot className={`${ic} text-yellow-400`} />, color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  { id: "continue", name: "Continue", docsUrl: "https://docs.continue.dev", icon: <FileCode className={`${ic} text-sky-400`} />, color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  { id: "codegemini", name: "CodeGemini", docsUrl: "https://cloud.google.com/code-gemini", icon: <SiGooglegemini className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "amazon-q", name: "Amazon Q", docsUrl: "https://docs.aws.amazon.com/amazonq", icon: <Cpu className={`${ic} text-orange-400`} />, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "supermaven", name: "Supermaven", docsUrl: "https://supermaven.com/docs", icon: <Workflow className={`${ic} text-purple-400`} />, color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  { id: "codeium", name: "Codeium", docsUrl: "https://docs.codeium.com", icon: <Puzzle className={`${ic} text-teal-400`} />, color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  { id: "mintlify", name: "Mintlify", docsUrl: "https://mintlify.com/docs", icon: <SiMintlify className={`${ic} text-lime-400`} />, color: "bg-lime-500/10 text-lime-400 border-lime-500/20" },
  { id: "vscode", name: "VS Code", icon: <FileCode className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20", docsUrl: "https://code.visualstudio.com/docs" },
  { id: "jetbrains", name: "JetBrains", docsUrl: "https://www.jetbrains.com/ai", icon: <SiJetbrains className={`${ic} text-pink-400`} />, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { id: "custom", name: "Custom Client", docsUrl: "#", icon: <Terminal className={`${ic} text-muted-foreground`} />, color: "bg-white/5 text-muted-foreground border-white/10" },
];

function TerminalBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group rounded-lg overflow-hidden border bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="h-7 w-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="text-xs font-mono leading-5 text-gray-200 whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

function McpServerPage() {
  const [selLLM, setSelLLM] = useState("claude");
  const [llmQ, setLlmQ] = useState("");
  const [testRes, setTestRes] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!llmQ) return LLM_TABS;
    const q = llmQ.toLowerCase();
    return LLM_TABS.filter(l => l.name.toLowerCase().includes(q) || l.id.includes(q));
  }, [llmQ]);

  const baseUrl = window.location.origin;

  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast({ title: "Copied" }); }
    catch { toast({ title: "Failed to copy", variant: "destructive" }); }
  };

  const llmConfig = (llmId: string): string => {
    const k = "<YOUR_API_KEY>";
    const cfg = `"mcpServers": {\n    "audnix": {\n      "url": "${baseUrl}/mcp",\n      "headers": { "Authorization": "Bearer ${k}" }\n    }\n  }`;
    const map: Record<string, string> = {
      claude: `{\n  ${cfg}\n}`,
      cursor: `// ~/.cursor/mcp.json\n{\n  ${cfg}\n}`,
      windsurf: `// ~/.windsurf/mcp_config.json\n{\n  ${cfg}\n}`,
      cline: `// cline_mcp_settings.json\n{\n  ${cfg}\n}`,
      openai: `{\n  "mcp_server": { "name": "audnix", "endpoint": "${baseUrl}/mcp", "api_key": "${k}" }\n}`,
      "github-copilot": `// ~/.github/copilot/mcp.json\n{\n  ${cfg}\n}`,
      "continue": `// ~/.continue/config.json\n{\n  "experimental": {\n    ${cfg}\n  }\n}`,
      "codegemini": `{\n  ${cfg}\n}`,
      "amazon-q": `// ~/.aws/amazonq/mcp.json\n{\n  ${cfg}\n}`,
      supermaven: `// ~/.supermaven/mcp.json\n{\n  ${cfg}\n}`,
      codeium: `{\n  ${cfg}\n}`,
      mintlify: `// mint.json\n{\n  ${cfg}\n}`,
      vscode: `// ~/.vscode/mcp.json\n{\n  ${cfg}\n}`,
      jetbrains: `# Toolbox → MCP Servers\nurl: ${baseUrl}/mcp\nheaders:\n  Authorization: "Bearer ${k}"`,
      custom: `// mcp_servers.json\n{\n  ${cfg}\n}`,
    };
    return map[llmId] || map.custom;
  };

  return (
    <>
      <Helmet>
        <title>MCP Server Setup | Audnix AI — Connect AI Coding Agents to Your Email Outreach Data</title>
        <meta name="description" content="Configure Audnix MCP (Model Context Protocol) server to connect Claude, Cursor, Cline, Windsurf, and other AI coding assistants to your email outreach campaigns, leads, and analytics in real-time." />
        <meta property="og:title" content="MCP Server — AI Agent Integration | Audnix" />
        <meta property="og:description" content="Connect Claude, Cursor, Cline, and other AI coding agents to your Audnix email outreach data via MCP protocol. Real-time read/write access to campaigns, leads, and analytics." />
        <meta name="robots" content="index, follow" />
      </Helmet>
    <PageWrapper className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP Server</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Model Context Protocol</p>
        </div>
        <Badge variant="outline" className="text-[10px]">v1.0</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Endpoint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2.5 bg-muted/30 rounded-lg border font-mono text-sm break-all">{baseUrl}/mcp</code>
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => copy(`${baseUrl}/mcp`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Protocol</span>
                <p className="font-mono text-xs">JSON-RPC 2.0</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Auth</span>
                <p className="font-mono text-xs">Bearer</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Play className="h-4 w-4 text-muted-foreground" />
              Test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={async () => {
                setTestRes(null);
                try {
                  const r = await fetch("/mcp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
                  });
                  if (r.ok) {
                    const j = await r.json();
                    setTestRes(`Connected (${j.result?.tools?.length || 0} tools)`);
                    toast({ title: "Connected" });
                  } else {
                    setTestRes("Failed");
                    toast({ title: "Failed", variant: "destructive" });
                  }
                } catch {
                  setTestRes("Error");
                  toast({ title: "Connection error", variant: "destructive" });
                }
              }}
            >
              Test connection
            </Button>
            {testRes && (
              <div className={`text-xs p-2 rounded border ${testRes.startsWith("Connected") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
                {testRes}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search providers..."
              value={llmQ}
              onChange={e => setLlmQ(e.target.value)}
              className="pl-9"
            />
          </div>

          <Tabs value={selLLM} onValueChange={setSelLLM}>
            <div className="overflow-x-auto -mx-1 pb-1">
              <TabsList className="inline-flex h-auto gap-1 bg-transparent mb-4 min-w-max px-1">
                {filtered.map(llm => (
                  <TabsTrigger
                    key={llm.id}
                    value={llm.id}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-transparent hover:bg-muted/50 transition-all data-[state=active]:border"
                  >
                    {llm.icon}
                    <span className="hidden sm:inline">{llm.name}</span>
                  </TabsTrigger>
                ))}
                {filtered.length === 0 && <p className="text-xs text-muted-foreground px-2">No matches</p>}
              </TabsList>
            </div>

            {LLM_TABS.map(llm => (
              <TabsContent key={llm.id} value={llm.id}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${llm.color}`}>{llm.icon}</div>
                      <div>
                        <p className="font-medium">{llm.name}</p>
                        {llm.sub && <p className="text-xs text-muted-foreground">{llm.sub}</p>}
                      </div>
                    </div>
                    {llm.docsUrl !== "#" && (
                      <a href={llm.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                        Docs <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <TerminalBlock code={llmConfig(llm.id)} />
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </PageWrapper>
    </>
  );
}

export default McpServerPage;
