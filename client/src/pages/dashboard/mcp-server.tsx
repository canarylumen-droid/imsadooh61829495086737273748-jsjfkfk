import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const ic = "h-4 w-4 shrink-0";

type LlmEntry = { id: string; name: string; docsUrl: string; icon: React.ReactNode; color: string; sub?: string };

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
  { id: "v0", name: "V0", docsUrl: "https://v0.dev/docs", icon: <SiVercel className={`${ic} text-white`} />, color: "bg-white/10 text-white border-white/20" },
  { id: "lovable", name: "Lovable", docsUrl: "https://lovable.dev/docs", icon: <Heart className={`${ic} text-rose-400`} />, color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  { id: "bolt", name: "Bolt.new", docsUrl: "https://bolt.new/docs", icon: <Radius className={`${ic} text-yellow-400`} />, color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  { id: "warp", name: "Warp", docsUrl: "https://docs.warp.dev", icon: <SiWarp className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "replit", name: "Replit", docsUrl: "https://docs.replit.com", icon: <SiReplit className={`${ic} text-amber-400`} />, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { id: "codesandbox", name: "CodeSandbox", docsUrl: "https://codesandbox.io/docs", icon: <SiCodesandbox className={`${ic} text-gray-300`} />, color: "bg-gray-500/10 text-gray-300 border-gray-500/20" },
  { id: "stackblitz", name: "StackBlitz", docsUrl: "https://developer.stackblitz.com", icon: <SiStackblitz className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "gitpod", name: "Gitpod", docsUrl: "https://www.gitpod.io/docs", icon: <SiGitpod className={`${ic} text-indigo-400`} />, color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  { id: "jetbrains", name: "JetBrains", docsUrl: "https://www.jetbrains.com/ai", icon: <SiJetbrains className={`${ic} text-pink-400`} />, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { id: "vscode", name: "VS Code", icon: <FileCode className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20", docsUrl: "https://code.visualstudio.com/docs" },
  { id: "intellij", name: "IntelliJ", docsUrl: "https://www.jetbrains.com/idea/", icon: <SiIntellijidea className={`${ic} text-pink-400`} />, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { id: "xcode", name: "Xcode", docsUrl: "https://developer.apple.com/xcode/", icon: <SiXcode className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "android-studio", name: "Android Studio", docsUrl: "https://developer.android.com/studio", icon: <SiAndroidstudio className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "pycharm", name: "PyCharm", docsUrl: "https://www.jetbrains.com/pycharm/", icon: <SiPycharm className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "vim", name: "Vim", docsUrl: "https://www.vim.org/", icon: <FileCode className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "neovim", name: "Neovim", docsUrl: "https://neovim.io/", icon: <SiNeovim className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "sublime", name: "Sublime Text", docsUrl: "https://www.sublimetext.com/", icon: <SiSublimetext className={`${ic} text-orange-400`} />, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "custom", name: "Custom Client", docsUrl: "#", icon: <Terminal className={`${ic} text-muted-foreground`} />, color: "bg-white/5 text-muted-foreground border-white/10" },
];

function TerminalBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative group rounded-lg overflow-hidden border border-white/10 bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <button
          onClick={doCopy}
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
  const [testKey, setTestKey] = useState("");

  const filtered = useMemo(() => {
    if (!llmQ) return LLM_TABS;
    const q = llmQ.toLowerCase();
    return LLM_TABS.filter(l => l.name.toLowerCase().includes(q) || l.id.includes(q));
  }, [llmQ]);

  const baseUrl = window.location.origin;
  const keyLabel = "<YOUR_API_KEY>";

  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast({ title: "Copied" }); }
    catch { toast({ title: "Failed to copy", variant: "destructive" }); }
  };

  const llmConfig = (llmId: string): string => {
    const k = testKey || "<YOUR_API_KEY>";
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
      v0: `{\n  ${cfg}\n}`,
      lovable: `// lovable.config.json\n{\n  ${cfg}\n}`,
      bolt: `{\n  ${cfg}\n}`,
      warp: `// ~/.warp/mcp.json\n{\n  ${cfg}\n}`,
      replit: `# Secrets\nMCP_URL="${baseUrl}/mcp"\nMCP_API_KEY="${k}"`,
      codesandbox: `// .codesandbox/mcp.json\n{\n  ${cfg}\n}`,
      stackblitz: `// stackblitz.config.json\n{\n  ${cfg}\n}`,
      gitpod: `# .gitpod.yml\nports:\n  - port: 3000\ntasks:\n  - command: |\n      export MCP_API_KEY="${k}"\n      export MCP_URL="${baseUrl}/mcp"`,
      vscode: `// ~/.vscode/mcp.json\n{\n  ${cfg}\n}`,
      jetbrains: `# Toolbox → MCP Servers\nurl: ${baseUrl}/mcp\nheaders:\n  Authorization: "Bearer ${k}"`,
      xcode: `// ~/.xcode/mcp.json\n{\n  ${cfg}\n}`,
      "android-studio": `// ~/.android-studio/mcp.json\n{\n  ${cfg}\n}`,
      intellij: `// ~/.idea/mcp.json\n{\n  ${cfg}\n}`,
      pycharm: `// ~/.pycharm/mcp.json\n{\n  ${cfg}\n}`,
      vim: `" ~/.vimrc\nlet g:mcp_url = "${baseUrl}/mcp"\nlet g:mcp_key = "${k}"`,
      neovim: `-- ~/.config/nvim/init.lua\nvim.g.mcp_url = "${baseUrl}/mcp"\nvim.g.mcp_key = "${k}"`,
      sublime: `// Sublime Text → Preferences\n{\n  ${cfg}\n}`,
      custom: `// mcp_servers.json\n{\n  ${cfg}\n}`,
    };
    return map[llmId] || map.custom;
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Terminal className="h-6 w-6 text-primary" />
            MCP Server
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Model Context Protocol</p>
        </div>
        <Badge variant="outline" className="border-primary/30 text-primary">v1.0</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-white/5 border-white/10 lg:col-span-2">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              Endpoint
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-black/50 rounded border border-white/10 font-mono text-xs md:text-sm break-all">{baseUrl}/mcp</code>
              <Button variant="outline" size="icon" className="border-white/10 shrink-0" onClick={() => copy(`${baseUrl}/mcp`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Protocol</p>
                <p className="font-mono text-xs">JSON-RPC 2.0</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Auth</p>
                <p className="font-mono text-xs">Bearer audnix_*</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Test
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-3">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Paste your API key to test the connection:</p>
              <Input
                value={testKey}
                onChange={e => setTestKey(e.target.value)}
                placeholder="audnix_..."
                className="bg-white/5 border-white/10 text-xs font-mono"
              />
            </div>
            <Button
              className="w-full"
              disabled={!testKey.startsWith('audnix_')}
              onClick={async () => {
                setTestRes(null);
                try {
                  const r = await fetch("/mcp", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${testKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
                  });
                  const j = await r.json();
                  setTestRes(r.ok ? "Connected" : `Error: ${j.error || r.statusText}`);
                  toast({ title: r.ok ? "OK" : "Failed", variant: r.ok ? "default" : "destructive" });
                } catch (e: any) {
                  setTestRes(`Error: ${e.message}`);
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

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search providers..."
              value={llmQ}
              onChange={e => setLlmQ(e.target.value)}
              className="pl-9 bg-white/5 border-white/10 text-sm"
            />
          </div>

          <Tabs value={selLLM} onValueChange={setSelLLM}>
            <div className="overflow-x-auto -mx-1 pb-1 scrollbar-thin scrollbar-thumb-white/10">
              <TabsList className="inline-flex h-auto gap-1 bg-transparent mb-4 min-w-max px-1">
                {filtered.map(llm => (
                  <TabsTrigger
                    key={llm.id}
                    value={llm.id}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-transparent data-[state=active]:${llm.color} data-[state=active]:border hover:bg-white/5 transition-all`}
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
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${llm.color}`}>{llm.icon}</div>
                      <div>
                        <p className="text-sm font-semibold">{llm.name}</p>
                        {llm.sub && <p className="text-xs text-muted-foreground">{llm.sub}</p>}
                      </div>
                    </div>
                    {llm.docsUrl !== "#" && (
                      <a href={llm.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                        Docs <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">MCP config for {llm.name}</p>
                    <TerminalBlock code={llmConfig(llm.id)} />
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Quick test with cURL</p>
                    <TerminalBlock code={`curl -X POST "${baseUrl}/mcp" \\\n  -H "Authorization: Bearer ${keyLabel}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`} />
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground/40">
        API keys are created and managed on the <a href="/dashboard/developer" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Developer</a> page.
        Copy your key there and paste it above to test and generate configs.
      </p>
    </div>
  );
}

export default McpServerPage;
