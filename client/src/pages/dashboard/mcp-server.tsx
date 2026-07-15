import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import {
  Key, Copy, Check, RotateCcw, Eye, EyeOff, Terminal, Globe,
  Shield, Zap, Loader2, Server, BookOpen, Play, AlertTriangle,
  ChevronDown, ChevronRight, Lock, Unlock, Code, TestTube,
  ExternalLink, Search, Sparkles, Heart, Cpu, Workflow,
  Puzzle, PanelRightOpen, Languages, FileCode, Mail, Grip,
  ArrowUpRight, Binoculars, Radius, Info,
} from "lucide-react";
import {
  SiClaude, SiCursor, SiWindsurf, SiCline, SiGithubcopilot,
  SiGooglegemini, SiWarp, SiMintlify, SiVercel, SiReplit,
  SiCodesandbox, SiStackblitz, SiGitpod, SiJetbrains,
  SiPython, SiJavascript, SiTypescript, SiGo, SiRust,
  SiKotlin, SiSwift, SiRuby, SiPhp, SiDotnet,
  SiAnthropic, SiXcode, SiVim, SiIntellijidea,
  SiAndroidstudio, SiPycharm, SiNeovim, SiSublimetext,
} from "react-icons/si";
import { PremiumLoader } from "@/components/ui/premium-loader";

type McpKey = { id: string; name: string; permissionLevel: "read_only" | "read_write"; scopes: string[]; isActive: boolean; createdAt: string | null; lastUsedAt: string | null };
type McpTool = { name: string; description: string; blocked: boolean; needsScope: string | null };
type CategoryGroup = { category: string; tools: McpTool[] };
interface LlmEntry { id: string; name: string; docsUrl: string; icon: React.ReactNode; color: string; sub?: string }
interface LangEntry { id: string; name: string; icon: React.ReactNode; color: string }

const ic = "h-4 w-4 shrink-0";

const LLM_TABS: LlmEntry[] = [
  { id: "claude", name: "Claude", sub: "by Anthropic", docsUrl: "https://docs.anthropic.com/en/docs/claude-integrations", icon: <span className="flex -space-x-1"><SiClaude className={`${ic} text-orange-400`} /><SiAnthropic className={`${ic} text-orange-300`} /></span>, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "openai", name: "OpenAI", docsUrl: "https://platform.openai.com/docs", icon: <Sparkles className={`${ic} text-emerald-400`} />, color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { id: "cursor", name: "Cursor", docsUrl: "https://docs.cursor.com/get-started/mcp", icon: <SiCursor className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "windsurf", name: "Windsurf", docsUrl: "https://codeium.com/windsurf", icon: <SiWindsurf className={`${ic} text-cyan-400`} />, color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { id: "cline", name: "Cline", docsUrl: "https://github.com/nicepkg/Cline", icon: <SiCline className={`${ic} text-violet-400`} />, color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  { id: "continue", name: "Continue", docsUrl: "https://docs.continue.dev", icon: <PanelRightOpen className={`${ic} text-sky-400`} />, color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  { id: "github-copilot", name: "Copilot", docsUrl: "https://docs.github.com/en/copilot", icon: <SiGithubcopilot className={`${ic} text-yellow-400`} />, color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  { id: "sourcegraph", name: "Cody", docsUrl: "https://sourcegraph.com/docs/cody", icon: <Binoculars className={`${ic} text-fuchsia-400`} />, color: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20" },
  { id: "tabnine", name: "Tabnine", docsUrl: "https://docs.tabnine.com", icon: <Zap className={`${ic} text-amber-400`} />, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { id: "codegemini", name: "CodeGemini", docsUrl: "https://cloud.google.com/code-gemini", icon: <SiGooglegemini className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "amazon-q", name: "Amazon Q", docsUrl: "https://docs.aws.amazon.com/amazonq", icon: <Cpu className={`${ic} text-orange-400`} />, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "supermaven", name: "Supermaven", docsUrl: "https://supermaven.com/docs", icon: <Workflow className={`${ic} text-purple-400`} />, color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  { id: "warp", name: "Warp", docsUrl: "https://docs.warp.dev", icon: <SiWarp className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "codeium", name: "Codeium", docsUrl: "https://docs.codeium.com", icon: <Puzzle className={`${ic} text-teal-400`} />, color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  { id: "mintlify", name: "Mintlify", docsUrl: "https://mintlify.com/docs", icon: <SiMintlify className={`${ic} text-lime-400`} />, color: "bg-lime-500/10 text-lime-400 border-lime-500/20" },
  { id: "v0", name: "V0", docsUrl: "https://v0.dev/docs", icon: <SiVercel className={`${ic} text-white`} />, color: "bg-white/10 text-white border-white/20" },
  { id: "lovable", name: "Lovable", docsUrl: "https://lovable.dev/docs", icon: <Heart className={`${ic} text-rose-400`} />, color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  { id: "bolt", name: "Bolt.new", docsUrl: "https://bolt.new/docs", icon: <Radius className={`${ic} text-yellow-400`} />, color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  { id: "replit", name: "Replit AI", docsUrl: "https://docs.replit.com", icon: <SiReplit className={`${ic} text-amber-400`} />, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { id: "codesandbox", name: "CodeSandbox", docsUrl: "https://codesandbox.io/docs", icon: <SiCodesandbox className={`${ic} text-gray-300`} />, color: "bg-gray-500/10 text-gray-300 border-gray-500/20" },
  { id: "stackblitz", name: "StackBlitz", docsUrl: "https://developer.stackblitz.com", icon: <SiStackblitz className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "gitpod", name: "Gitpod", docsUrl: "https://www.gitpod.io/docs", icon: <SiGitpod className={`${ic} text-indigo-400`} />, color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  { id: "vscode", name: "VS Code", docsUrl: "https://code.visualstudio.com/docs", icon: <FileCode className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "jetbrains", name: "JetBrains AI", docsUrl: "https://www.jetbrains.com/ai", icon: <SiJetbrains className={`${ic} text-pink-400`} />, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { id: "xcode", name: "Xcode", docsUrl: "https://developer.apple.com/xcode/", icon: <SiXcode className={`${ic} text-blue-400`} />, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "android-studio", name: "Android Studio", docsUrl: "https://developer.android.com/studio", icon: <SiAndroidstudio className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "intellij", name: "IntelliJ IDEA", docsUrl: "https://www.jetbrains.com/idea/", icon: <SiIntellijidea className={`${ic} text-pink-400`} />, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { id: "pycharm", name: "PyCharm", docsUrl: "https://www.jetbrains.com/pycharm/", icon: <SiPycharm className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "vim", name: "Vim", docsUrl: "https://www.vim.org/", icon: <SiVim className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "neovim", name: "Neovim", docsUrl: "https://neovim.io/", icon: <SiNeovim className={`${ic} text-green-400`} />, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { id: "sublime", name: "Sublime Text", docsUrl: "https://www.sublimetext.com/", icon: <SiSublimetext className={`${ic} text-orange-400`} />, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "custom", name: "Custom Client", docsUrl: "#", icon: <Terminal className={`${ic} text-muted-foreground`} />, color: "bg-white/5 text-muted-foreground border-white/10" },
];

const LANGUAGE_OPTIONS: LangEntry[] = [
  { id: "curl", name: "cURL", icon: <Terminal className="h-4 w-4 shrink-0 text-green-400" />, color: "text-green-400" },
  { id: "python", name: "Python", icon: <SiPython className="h-4 w-4 shrink-0 text-blue-400" />, color: "text-blue-400" },
  { id: "javascript", name: "JS", icon: <SiJavascript className="h-4 w-4 shrink-0 text-yellow-400" />, color: "text-yellow-400" },
  { id: "typescript", name: "TS", icon: <SiTypescript className="h-4 w-4 shrink-0 text-blue-400" />, color: "text-blue-400" },
  { id: "go", name: "Go", icon: <SiGo className="h-4 w-4 shrink-0 text-cyan-400" />, color: "text-cyan-400" },
  { id: "rust", name: "Rust", icon: <SiRust className="h-4 w-4 shrink-0 text-orange-400" />, color: "text-orange-400" },
  { id: "java", name: "Java", icon: <Languages className="h-4 w-4 shrink-0 text-red-400" />, color: "text-red-400" },
  { id: "kotlin", name: "Kotlin", icon: <SiKotlin className="h-4 w-4 shrink-0 text-purple-400" />, color: "text-purple-400" },
  { id: "swift", name: "Swift", icon: <SiSwift className="h-4 w-4 shrink-0 text-orange-400" />, color: "text-orange-400" },
  { id: "ruby", name: "Ruby", icon: <SiRuby className="h-4 w-4 shrink-0 text-red-400" />, color: "text-red-400" },
  { id: "php", name: "PHP", icon: <SiPhp className="h-4 w-4 shrink-0 text-indigo-400" />, color: "text-indigo-400" },
  { id: "csharp", name: "C#", icon: <SiDotnet className="h-4 w-4 shrink-0 text-green-400" />, color: "text-green-400" },
];

function ch(lang: string): string {
  const f = (LANGUAGE_OPTIONS.find(l => l.id === lang)?.name || lang).toLowerCase();
  return f === "curl" ? "curl" : f === "js" ? "javascript" : f === "ts" ? "typescript" : f;
}

function genSnippet(lang: string, key: string, url: string): string {
  const k = key || "<YOUR_API_KEY>";
  const p = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_campaigns", arguments: {} } }, null, 2);
  switch (lang) {
    case "curl": return `curl -X POST "${url}/mcp" \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '${p.replace(/\n/g, "\n  ")}'`;
    case "python": return `import requests\n\nurl = "${url}/mcp"\nheaders = {"Authorization": "Bearer ${k}", "Content-Type": "application/json"}\nresponse = requests.post(url, json=${p.replace(/\n\s*/g, " ").replace(/",/g, '",').replace(/: "/g, ': "')}, headers=headers)\nprint(response.json())`;
    case "javascript": return `const response = await fetch("${url}/mcp", {\n  method: "POST",\n  headers: { Authorization: "Bearer ${k}", "Content-Type": "application/json" },\n  body: JSON.stringify(${p.replace(/\n\s*/g, " ")})\n});\nconst data = await response.json();\nconsole.log(data);`;
    case "typescript": return `import axios from "axios";\n\nconst response = await axios.post("${url}/mcp",\n  ${p.replace(/\n\s*/g, " ").replace(/,\s*$/, "")},\n  { headers: { Authorization: \`Bearer ${k}\`, "Content-Type": "application/json" } }\n);\nconsole.log(response.data);`;
    case "go": return `package main\n\nimport ("bytes";"encoding/json";"fmt";"net/http")\n\nfunc main() {\n  body, _ := json.Marshal(map[string]any{\n    "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n    "params": map[string]any{"name": "get_campaigns", "arguments": map[string]any{}},\n  })\n  req, _ := http.NewRequest("POST", "${url}/mcp", bytes.NewBuffer(body))\n  req.Header.Set("Authorization", "Bearer ${k}")\n  req.Header.Set("Content-Type", "application/json")\n  resp, _ := http.DefaultClient.Do(req)\n  defer resp.Body.Close()\n  var res map[string]any; json.NewDecoder(resp.Body).Decode(&res); fmt.Println(res)\n}`;
    case "rust": return `use reqwest;\nuse serde_json::json;\n\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let client = reqwest::Client::new();\n    let payload = json!({\n        "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n        "params": {"name": "get_campaigns", "arguments": {}},\n    });\n    let resp = client.post("${url}/mcp")\n        .header("Authorization", "Bearer ${k}")\n        .json(&payload).send().await?;\n    println!("{:#}", resp.json::<serde_json::Value>().await?);\n    Ok(())\n}`;
    case "java": return `import java.net.URI;\nimport java.net.http.*;\n\nvar payload = """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_campaigns","arguments":{}}}""";\nvar client = HttpClient.newHttpClient();\nvar request = HttpRequest.newBuilder()\n  .uri(URI.create("${url}/mcp"))\n  .header("Authorization", "Bearer ${k}")\n  .header("Content-Type", "application/json")\n  .POST(HttpRequest.BodyPublishers.ofString(payload))\n  .build();\nclient.send(request, HttpResponse.BodyHandlers.ofString()).body().thenAccept(System.out::println);`;
    case "kotlin": return `import io.ktor.client.*\nimport io.ktor.client.call.*\nimport io.ktor.client.request.*\nimport io.ktor.http.*\n\nval client = HttpClient()\nval response = client.post("${url}/mcp") {\n    header("Authorization", "Bearer ${k}")\n    contentType(ContentType.Application.Json)\n    setBody("""{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_campaigns","arguments":{}}}""")\n}\nprintln(response.body<String>())`;
    case "swift": return `import Foundation\n\nvar req = URLRequest(url: URL(string: "${url}/mcp")!)\nreq.httpMethod = "POST"\nreq.setValue("Bearer ${k}", forHTTPHeaderField: "Authorization")\nreq.setValue("application/json", forHTTPHeaderField: "Content-Type")\nreq.httpBody = try JSONSerialization.data(withJSONObject: [\n  "jsonrpc": "2.0", "id": 1, "method": "tools/call",\n  "params": ["name": "get_campaigns", "arguments": [:]]\n])\nURLSession.shared.dataTask(with: req) { d,_,_ in if let d=d {print(String(data:d,encoding:.utf8)!) } }.resume()`;
    case "ruby": return `require 'net/http'; require 'uri'; require 'json'\n\nuri = URI("${url}/mcp")\nhttp = Net::HTTP.new(uri.host, uri.port); http.use_ssl = uri.scheme == 'https'\nreq = Net::HTTP::Post.new(uri.path)\nreq["Authorization"] = "Bearer ${k}"\nreq["Content-Type"] = "application/json"\nreq.body = {jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_campaigns", arguments: {} }}.to_json\nputs http.request(req).body`;
    case "php": return `<?php\n$ch = curl_init("${url}/mcp");\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_HTTPHEADER => ["Authorization: Bearer ${k}", "Content-Type: application/json"],\n  CURLOPT_POSTFIELDS => json_encode(["jsonrpc"=>"2.0","id"=>1,"method"=>"tools/call","params"=>["name"=>"get_campaigns","arguments"=>(object)[]]]),\n  CURLOPT_RETURNTRANSFER => true\n]);\necho curl_exec($ch);\ncurl_close($ch);`;
    case "csharp": return `using System.Text;\nusing System.Text.Json;\n\nvar payload = JsonSerializer.Serialize(new {\n  jsonrpc = "2.0", id = 1, method = "tools/call",\n  @params = new { name = "get_campaigns", arguments = new { } }\n});\nvar client = new HttpClient();\nclient.DefaultRequestHeaders.Add("Authorization", "Bearer ${k}");\nvar response = await client.PostAsync("${url}/mcp",\n  new StringContent(payload, Encoding.UTF8, "application/json"));\nConsole.WriteLine(await response.Content.ReadAsStringAsync());`;
    default: return `curl -X POST "${url}/mcp" -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" -d '${p}'`;
  }
}

function llmConfig(llmId: string, key: string, url: string): string {
  const k = key || "<YOUR_API_KEY>";
  const cfg = `"mcpServers": {\n    "audnix": {\n      "url": "${url}/mcp",\n      "headers": { "Authorization": "Bearer ${k}" }\n    }\n  }`;
  const m: Record<string, string> = {
    claude: `{\n  ${cfg}\n}`,
    openai: `{\n  "mcp_server": { "name": "audnix", "endpoint": "${url}/mcp", "api_key": "${k}" }\n}`,
    cursor: `// ~/.cursor/mcp.json\n{\n  ${cfg}\n}`,
    windsurf: `// ~/.windsurf/mcp_config.json\n{\n  ${cfg}\n}`,
    cline: `// cline_mcp_settings.json\n{\n  ${cfg}\n}`,
    "continue": `// ~/.continue/config.json\n{\n  "experimental": {\n    ${cfg}\n  }\n}`,
    "github-copilot": `// ~/.github/copilot/mcp.json\n{\n  ${cfg}\n}`,
    sourcegraph: `{\n  ${cfg}\n}`,
    tabnine: `// tabnine_config.json\n{\n  ${cfg}\n}`,
    codegemini: `{\n  ${cfg}\n}`,
    "amazon-q": `// ~/.aws/amazonq/mcp.json\n{\n  ${cfg}\n}`,
    supermaven: `// ~/.supermaven/mcp.json\n{\n  ${cfg}\n}`,
    warp: `// ~/.warp/mcp.json\n{\n  ${cfg}\n}`,
    codeium: `{\n  ${cfg}\n}`,
    mintlify: `// mint.json\n{\n  ${cfg}\n}`,
    v0: `{\n  ${cfg}\n}`,
    lovable: `// lovable.config.json\n{\n  ${cfg}\n}`,
    bolt: `{\n  ${cfg}\n}`,
    replit: `# replit.nix or Secrets\nMCP_URL="${url}/mcp"\nMCP_API_KEY="${k}"`,
    codesandbox: `// .codesandbox/mcp.json\n{\n  ${cfg}\n}`,
    stackblitz: `// stackblitz.config.json\n{\n  ${cfg}\n}`,
    gitpod: `# .gitpod.yml\nports:\n  - port: 3000\ntasks:\n  - command: |\n      export MCP_API_KEY="${k}"\n      export MCP_URL="${url}/mcp"`,
    vscode: `// ~/.vscode/mcp.json\n{\n  ${cfg}\n}`,
    jetbrains: `# Toolbox → MCP Servers\nurl: ${url}/mcp\nheaders:\n  Authorization: "Bearer ${k}"`,
    xcode: `// ~/.xcode/mcp.json\n{\n  ${cfg}\n}`,
    "android-studio": `// ~/.android-studio/mcp.json\n{\n  ${cfg}\n}`,
    intellij: `// ~/.idea/mcp.json\n{\n  ${cfg}\n}`,
    pycharm: `// ~/.pycharm/mcp.json\n{\n  ${cfg}\n}`,
    vim: `" let ~/.vimrc\nlet g:mcp_url = "${url}/mcp"\nlet g:mcp_key = "${k}"`,
    neovim: `-- ~/.config/nvim/init.lua\nvim.g.mcp_url = "${url}/mcp"\nvim.g.mcp_key = "${k}"`,
    sublime: `// Sublime Text → Preferences → Settings\n{\n  ${cfg}\n}`,
    custom: `// mcp_servers.json\n{\n  ${cfg}\n}`,
  };
  return m[llmId] || m.custom;
}

function groupToolsByCategory(tools: McpTool[]): CategoryGroup[] {
  const cats: Record<string, McpTool[]> = {};
  for (const t of tools) {
    const p = t.name.split("_");
    const c = p[0].charAt(0).toUpperCase() + p[0].slice(1);
    (cats[c] ||= []).push(t);
  }
  return Object.entries(cats).map(([c, t]) => ({ category: c, tools: t }));
}

function TerminalBlock({ code, fileName, index = 0 }: { code: string; fileName?: string; index?: number }) {
  const [copied, setCopied] = useState(false);
  const [rippling, setRippling] = useState(false);
  const lines = code.split("\n");
  const doCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setRippling(true);
    setTimeout(() => setCopied(false), 1500);
    setTimeout(() => setRippling(false), 600);
  }, [code]);
  return (
    <div
      className={`relative group rounded-lg overflow-hidden border border-white/10 bg-[#0d1117] transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_20px_-5px] hover:shadow-primary/20 animate-in fade-in slide-in-from-bottom-2`}
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
    >
      {rippling && <span className="absolute inset-0 bg-primary/5 animate-pulse pointer-events-none rounded-lg" />}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-white/5 rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80 transition-transform hover:scale-110 cursor-pointer" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80 transition-transform hover:scale-110 cursor-pointer" />
            <div className="w-3 h-3 rounded-full bg-green-500/80 transition-transform hover:scale-110 cursor-pointer" />
          </div>
          {fileName && <span className="text-[11px] text-muted-foreground/60 ml-2 font-mono truncate max-w-[200px]">{fileName}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/30 font-mono hidden sm:block">{lines.length} lines</span>
          <button
            onClick={doCopy}
            className="h-7 w-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all active:scale-90"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex overflow-x-auto">
        <div className="select-none text-right pr-3 pl-2 py-3 text-[11px] leading-5 text-muted-foreground/25 font-mono border-r border-white/5 bg-[#0d1117] min-w-[2.5rem]">
          {lines.map((_, i) => <div key={i} className="transition-colors hover:text-muted-foreground/60">{i + 1}</div>)}
        </div>
        <pre className="flex-1 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-white/10">
          <code className="text-[12px] font-mono leading-5 text-gray-200 whitespace-pre">{code}</code>
        </pre>
      </div>
    </div>
  );
}

function McpServerPage() {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [nk, setNk] = useState<{ key: string; name: string } | null>(null);
  const [createName, setCreateName] = useState("My MCP Key");
  const [createPerm, setCreatePerm] = useState<"read" | "read_write">("read_write");
  const [selLLM, setSelLLM] = useState("claude");
  const [selLang, setSelLang] = useState("curl");
  const [testTool, setTestTool] = useState("get_campaigns");
  const [testRes, setTestRes] = useState<string | null>(null);
  const [testInp, setTestInp] = useState("{}");
  const [expCat, setExpCat] = useState<string | null>(null);
  const [conSubTab, setConSubTab] = useState("curl");
  const [llmQ, setLlmQ] = useState("");

  const { data: kd, isLoading: kl } = useQuery<{ key: McpKey | null }>({ queryKey: ["/api/mcp/key/current"] });
  const { data: td, isLoading: tl } = useQuery<{ tools: McpTool[] }>({ queryKey: ["/api/mcp/tools"] });

  const ak = kd?.key ?? null;

  const filtered = useMemo(() => {
    if (!llmQ) return LLM_TABS;
    const q = llmQ.toLowerCase();
    return LLM_TABS.filter(l => l.name.toLowerCase().includes(q) || l.id.includes(q) || (l.sub || "").toLowerCase().includes(q));
  }, [llmQ]);

  const cg = useMemo(() => td?.tools ? groupToolsByCategory(td.tools) : [], [td]);

  const ck = useMutation({
    mutationFn: (d: { name: string; permission_level: string }) => apiRequest("POST", "/api/mcp/key/create", d).then(r => r.json()),
    onSuccess: d => { setNk({ key: d.key, name: d.name }); toast({ title: "API Key Created", description: d.message }); qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] }); },
    onError: (e: Error) => toast({ title: "Failed to create key", description: e.message, variant: "destructive" }),
  });
  const rk = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/mcp/key/regenerate", { id }).then(r => r.json()),
    onSuccess: d => { setNk({ key: d.key, name: ak?.name || "API Key" }); toast({ title: "Key Regenerated", description: d.message }); qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] }); },
    onError: (e: Error) => toast({ title: "Failed to regenerate", description: e.message, variant: "destructive" }),
  });
  const us = useMutation({
    mutationFn: (d: { id: string; scopes: string[]; permission_level: string }) => apiRequest("POST", "/api/mcp/scopes", d).then(r => r.json()),
    onSuccess: () => { toast({ title: "Permissions Updated" }); qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] }); },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });
  const tm = useMutation({
    mutationFn: (d: { tool: string; args: any }) => apiRequest("POST", "/api/mcp/test", d).then(r => r.json()),
    onSuccess: d => { setTestRes(JSON.stringify(d, null, 2)); toast({ title: d.success ? "Test OK" : "Test Failed", description: `Tool: ${d.tool}` }); },
    onError: (e: Error) => { setTestRes(JSON.stringify({ error: e.message }, null, 2)); toast({ title: "Test Error", description: e.message, variant: "destructive" }); },
  });

  const baseUrl = window.location.origin;
  const masked = nk?.key || (ak ? `audnix_${ak.id?.substring(0, 4) || "****"}` : "audnix_********************");
  const dotMasked = masked.replace(/[^-]/g, "*");

  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000); }
    catch { toast({ title: "Failed to copy", variant: "destructive" }); }
  };

  const an = (d: number) => ({ animationDelay: `${d}ms`, animationFillMode: "both" as const });

  if (kl || tl) return <div className="min-h-screen bg-black text-white p-4 md:p-8"><PremiumLoader text="Loading MCP Server Settings..." /></div>;

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6 space-y-6 md:space-y-8 overflow-x-hidden">
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 8px -4px rgba(59,130,246,.15); } 50% { box-shadow: 0 0 20px -4px rgba(59,130,246,.3); } }
        .anim-card { animation: fadeSlideUp 0.5s ease-out both; }
        .anim-card:nth-child(1) { animation-delay: 0ms; }
        .anim-card:nth-child(2) { animation-delay: 80ms; }
        .anim-card:nth-child(3) { animation-delay: 160ms; }
        .anim-card:nth-child(4) { animation-delay: 240ms; }
        .anim-card:nth-child(5) { animation-delay: 320ms; }
        .card-hover { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .card-hover:hover { transform: translateY(-1px); border-color: rgba(59,130,246,.25) !important; box-shadow: 0 4px 24px -8px rgba(59,130,246,.15); }
        .tab-glow[data-state="active"] { animation: glowPulse 2s ease-in-out infinite; }
        .scrollbar-thin::-webkit-scrollbar { height: 4px; width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 4px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.15); }
      `}</style>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 anim-card">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            <Code className="h-7 w-7 md:h-8 md:w-8 text-primary shrink-0 animate-pulse" />
            <span>Connect any LLM</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Model Context Protocol (MCP) — connect AI assistants to your data</p>
        </div>
        <Badge variant="outline" className="self-start text-xs border-primary/30 text-primary shrink-0">MCP v1.0</Badge>
      </div>

      <div className="anim-card" style={an(40)}>
        <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
          <Shield className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300 space-y-1">
            <p><strong className="text-amber-200">Security Notice:</strong> Deleting accounts (<code className="text-[10px] font-mono bg-amber-500/10 px-1 rounded">delete_account</code>) is <strong>permanently blocked</strong> for all API keys — use the dashboard to delete your account. Deleting leads (<code className="text-[10px] font-mono bg-amber-500/10 px-1 rounded">delete_lead</code>) requires the <strong>"dangerous"</strong> scope and explicit confirmation.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card className="bg-white/5 border-white/10 anim-card card-hover">
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-lg"><Key className="h-5 w-5 text-primary shrink-0" />Credentials</CardTitle>
              <CardDescription>Manage your MCP API key for authentication</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-4">
              {ak ? (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        {ak.name}
                        <Badge variant="outline" className="text-[10px] border-primary/20 text-primary font-mono">SHA256</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Created {ak.createdAt ? new Date(ak.createdAt).toLocaleDateString() : "N/A"}
                        {ak.lastUsedAt && ` · Last used ${new Date(ak.lastUsedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <Badge variant={ak.permissionLevel === "read_only" ? "secondary" : "default"} className="self-start sm:self-auto">
                      {ak.permissionLevel === "read_only" ? "Read Only" : "Read/Write"}
                    </Badge>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <code className="flex-1 p-3 bg-black/50 rounded-lg border border-white/10 font-mono text-xs md:text-sm break-all select-all">
                      {showKey ? masked : dotMasked}
                    </code>
                    <div className="flex gap-1 self-end sm:self-auto">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="border-white/10" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{showKey ? "Hide" : "Show"}</TooltipContent></Tooltip></TooltipProvider>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="border-white/10" onClick={() => copy(masked)}>{keyCopied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>Copy</TooltipContent></Tooltip></TooltipProvider>
                    </div>
                  </div>
                  {nk?.key && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-300">Copy your API key now. You won't see it again after leaving.</p>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                    <div className="w-full sm:flex-1">
                      <Label className="text-xs mb-1.5 block">Permission</Label>
                      <Select value={ak.permissionLevel} onValueChange={v => us.mutate({ id: ak.id, scopes: ak.scopes, permission_level: v })}>
                        <SelectTrigger className="w-full bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read_only">Read Only</SelectItem>
                          <SelectItem value="read_write">Read/Write</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" className="border-white/10 w-full sm:w-auto hover:border-amber-500/30 hover:text-amber-400 transition-all" onClick={() => { if (ak && confirm("Regenerate? The old key stops working immediately.")) rk.mutate(ak.id); }} disabled={rk.isPending}>
                      {rk.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />} Regenerate
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">No API key found. Create one to start using the MCP server.</p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                    <div className="flex-1">
                      <Label className="text-xs mb-1.5 block">Key Name</Label>
                      <Input value={createName} onChange={e => setCreateName(e.target.value)} className="bg-white/5 border-white/10" placeholder="My MCP Key" />
                    </div>
                    <div className="w-full sm:w-40">
                      <Label className="text-xs mb-1.5 block">Permission</Label>
                      <Select value={createPerm} onValueChange={(v: "read" | "read_write") => setCreatePerm(v)}>
                        <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">Read Only</SelectItem>
                          <SelectItem value="read_write">Read/Write</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={() => ck.mutate({ name: createName, permission_level: createPerm })} disabled={ck.isPending || !createName.trim()}>
                      {ck.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Key className="h-4 w-4 mr-2" />} Create
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 anim-card card-hover" style={an(80)}>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-lg"><Shield className="h-5 w-5 text-primary shrink-0" />Tool Access <span className="text-sm font-normal text-muted-foreground">— {td?.tools?.length || 0} tools</span></CardTitle>
              <CardDescription>deleting leads requires the <strong className="text-amber-400">dangerous</strong> scope. Deleting accounts is <strong className="text-red-400">blocked</strong></CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
              {!ak ? <p className="text-sm text-muted-foreground">Create an API key first.</p> : cg.length === 0 ? <p className="text-sm text-muted-foreground">No tools available.</p> : (
                <div className="space-y-2">
                  {cg.map((g, gi) => (
                    <div key={g.category} className="border border-white/10 rounded-lg overflow-hidden transition-colors hover:border-white/20">
                      <button onClick={() => setExpCat(expCat === g.category ? null : g.category)} className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors text-left">
                        <span className="font-medium text-sm flex items-center gap-2">
                          {expCat === g.category ? <ChevronDown className="h-4 w-4 shrink-0 text-primary transition-transform" /> : <ChevronRight className="h-4 w-4 shrink-0 transition-transform" />}
                          {g.category}
                          <Badge variant="outline" className="ml-2 text-xs border-white/10">{g.tools.length}</Badge>
                        </span>
                      </button>
                      {expCat === g.category && (
                        <div className="border-t border-white/10 divide-y divide-white/5 animate-in fade-in slide-in-from-top-1">
                          {g.tools.map((t, ti) => {
                            const sn = t.needsScope || t.name;
                            const has = ak.scopes.includes(sn);
                            const ro = ak.permissionLevel === "read_only";
                            const wt = t.name.includes("send_") || t.name.includes("manage_") || t.name.includes("delete_");
                            const tog = !t.blocked && (!wt || !ro);
                            return (
                              <div key={t.name} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-2 transition-colors hover:bg-white/[0.02]" style={an(ti * 30)}>
                                <div className="flex items-start gap-3 min-w-0">
                                  {t.blocked ? <Lock className="h-4 w-4 text-red-400 mt-0.5 shrink-0" /> : has ? <Unlock className="h-4 w-4 text-green-400 mt-0.5 shrink-0" /> : <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <code className="text-xs font-mono break-all">{t.name}</code>
                                      {t.blocked && <Badge variant="destructive" className="text-[10px] px-1 py-0">Blocked</Badge>}
                                      {t.needsScope && !t.blocked && <Badge variant="outline" className={`text-[10px] px-1 py-0 ${t.needsScope === 'dangerous' ? 'border-red-500/40 text-red-400 bg-red-500/10' : 'border-amber-500/30 text-amber-400'}`}>{t.needsScope === 'dangerous' ? 'Dangerous' : t.needsScope}</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                                  </div>
                                </div>
                                {tog && (
                                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                    <span className="text-xs text-muted-foreground">Allow</span>
                                    <Switch checked={has} onCheckedChange={c => { const ns = c ? [...ak.scopes, sn] : ak.scopes.filter(s => s !== sn); us.mutate({ id: ak.id, scopes: ns, permission_level: ak.permissionLevel }); }} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-white/5 border-white/10 anim-card card-hover" style={an(160)}>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-lg"><Globe className="h-5 w-5 text-primary shrink-0" />Server Info</CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-3 text-sm">
              {[
                ["Endpoint URL", <div key="eu" className="flex items-center gap-2 mt-1"><code className="flex-1 p-2 bg-black/50 rounded border border-white/10 font-mono text-xs break-all">{baseUrl}/mcp</code><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(`${baseUrl}/mcp`)}>{keyCopied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}</Button></div>],
                ["Protocol", <span key="pr" className="font-medium text-sm">JSON-RPC 2.0 (MCP)</span>],
                ["Tools Available", <span key="ta" className="font-medium text-sm">{td?.tools?.length || 0} <span className="text-muted-foreground font-normal">total</span></span>],
                ["Authentication", <span key="au" className="font-medium text-sm">Bearer Token <code className="text-xs font-mono text-primary">audnix_*</code></span>],
                ["Key Hashing", <span key="kh" className="font-medium text-sm flex items-center gap-1.5"><Badge variant="outline" className="text-[10px] border-primary/20 text-primary font-mono">SHA-256</Badge> <span className="text-xs text-muted-foreground">stored as hash</span></span>],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <div>{val}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 anim-card card-hover" style={an(240)}>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-lg"><TestTube className="h-5 w-5 text-primary shrink-0" />Test Connection</CardTitle>
              <CardDescription>Try a tool call right now</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-3">
              <div>
                <Label className="text-xs mb-1.5 block">Tool</Label>
                <Select value={testTool} onValueChange={setTestTool}>
                  <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {td?.tools?.filter(t => !t.blocked).map(t => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Arguments <span className="text-muted-foreground font-normal">(JSON)</span></Label>
                <textarea value={testInp} onChange={e => setTestInp(e.target.value)} className="w-full p-2 bg-black/50 border border-white/10 rounded-lg font-mono text-xs h-20 resize-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20 transition-all" placeholder='{"leadId": "123"}' />
              </div>
              <Button className="w-full group" onClick={() => { let a = {}; try { a = JSON.parse(testInp); } catch {} tm.mutate({ tool: testTool, args: a }); }} disabled={!ak || tm.isPending}>
                {tm.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2 group-hover:translate-x-0.5 transition-transform" />}
                Run Test
              </Button>
              {testRes && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs mb-1.5 block">Result</Label>
                  <pre className="p-2 bg-black/50 border border-white/10 rounded-lg font-mono text-xs max-h-40 overflow-auto whitespace-pre-wrap break-all">{testRes}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-white/5 border-white/10 anim-card card-hover" style={an(320)}>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Code className="h-5 w-5 text-primary shrink-0" />
            One-click copy for any LLM
          </CardTitle>
          <CardDescription>Pick your AI provider, then choose cURL, a language SDK, or test live</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search providers or editors..." value={llmQ} onChange={e => setLlmQ(e.target.value)} className="pl-9 bg-white/5 border-white/10 text-sm" />
          </div>

          <Tabs value={selLLM} onValueChange={v => { setSelLLM(v); setLlmQ(""); }}>
            <div className="overflow-x-auto -mx-1 pb-1 scrollbar-thin">
              <TabsList className="inline-flex h-auto gap-1.5 bg-transparent mb-3 min-w-max px-1">
                {filtered.map(llm => (
                  <TabsTrigger key={llm.id} value={llm.id} className={`tab-glow flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-transparent data-[state=active]:${llm.color} data-[state=active]:border data-[state=inactive]:border-transparent data-[state=active]:shadow-none hover:bg-white/5 transition-all`}>
                    {llm.icon}
                    <span className="hidden sm:inline">{llm.name}</span>
                  </TabsTrigger>
                ))}
                {filtered.length === 0 && <p className="text-xs text-muted-foreground px-2">No matches for &quot;{llmQ}&quot;</p>}
              </TabsList>
            </div>

            {LLM_TABS.map((llm, lli) => (
              <TabsContent key={llm.id} value={llm.id}>
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded ${llm.color} transition-transform hover:scale-110`}>{llm.icon}</div>
                      <div>
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          {llm.name}
                          {llm.sub && <span className="text-[10px] text-muted-foreground font-normal">{llm.sub}</span>}
                        </p>
                      </div>
                    </div>
                    {llm.docsUrl !== "#" && (
                      <a href={llm.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 group/link">
                        Docs <ArrowUpRight className="h-3 w-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                      </a>
                    )}
                  </div>

                  <Tabs value={conSubTab} onValueChange={setConSubTab}>
                    <div className="overflow-x-auto -mx-1 pb-1 scrollbar-thin">
                      <TabsList className="inline-flex h-auto gap-1 bg-transparent mb-2 min-w-max px-1">
                        <TabsTrigger value="curl" className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 data-[state=active]:bg-white/10 data-[state=inactive]:bg-transparent data-[state=active]:shadow-none rounded-md hover:bg-white/5 transition-all">
                          <Terminal className="h-3.5 w-3.5 text-green-400" />
                          <span>cURL</span>
                        </TabsTrigger>
                        <TabsTrigger value="languages" className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 data-[state=active]:bg-white/10 data-[state=inactive]:bg-transparent data-[state=active]:shadow-none rounded-md hover:bg-white/5 transition-all">
                          <Languages className="h-3.5 w-3.5 text-primary" />
                          <span>Languages</span>
                        </TabsTrigger>
                        <TabsTrigger value="test" className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 data-[state=active]:bg-white/10 data-[state=inactive]:bg-transparent data-[state=active]:shadow-none rounded-md hover:bg-white/5 transition-all">
                          <Play className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Test</span>
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="curl">
                      <div className="space-y-3">
                        <TerminalBlock code={`curl -X POST "${baseUrl}/mcp" \\\n  -H "Authorization: Bearer ${nk?.key || (ak ? "audnix_" + ak.id?.substring(0, 4) + "..." : "<YOUR_API_KEY>")}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`} fileName="mcp-curl.sh" index={0} />
                        <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-blue-300 flex items-start gap-2">
                          <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium text-blue-200 mb-1">Where to put your API Key</p>
                            <p>Replace <code className="text-[10px] font-mono bg-blue-500/10 px-1 rounded">&lt;YOUR_API_KEY&gt;</code> with the key from the <strong>Credentials</strong> section above. Keep the <code className="text-[10px] font-mono bg-blue-500/10 px-1 rounded">audnix_</code> prefix.</p>
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="languages">
                      <Tabs value={selLang} onValueChange={setSelLang}>
                        <div className="overflow-x-auto -mx-1 pb-1 scrollbar-thin">
                          <TabsList className="inline-flex h-auto gap-1 bg-transparent mb-2 min-w-max px-1">
                            {LANGUAGE_OPTIONS.map(l => (
                              <TabsTrigger key={l.id} value={l.id} className="flex items-center gap-1.5 text-xs px-2 py-1.5 data-[state=active]:bg-white/10 data-[state=inactive]:bg-transparent data-[state=active]:shadow-none rounded-md hover:bg-white/5 transition-all">
                                {l.icon}
                                <span className="hidden sm:inline">{l.name}</span>
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </div>
                        <div className="overflow-x-auto">
                          {LANGUAGE_OPTIONS.map((l, li) => (
                            <TabsContent key={l.id} value={l.id}>
                              <TerminalBlock code={genSnippet(l.id, nk?.key || ak?.name || "", baseUrl)} fileName={`mcp-request.${ch(l.id)}`} index={li} />
                            </TabsContent>
                          ))}
                        </div>
                      </Tabs>
                    </TabsContent>

                    <TabsContent value="test">
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <Button
                            className="group"
                            onClick={async () => {
                              const rawKey = nk?.key || ak?.name || "";
                              if (!rawKey) { toast({ title: "No API Key", description: "Create a key in Credentials first", variant: "destructive" }); return; }
                              setTestRes(null);
                              try {
                                const r = await fetch("/mcp", {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${rawKey}`, "Content-Type": "application/json" },
                                  body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
                                });
                                const j = await r.json();
                                setTestRes(JSON.stringify(j, null, 2));
                                toast({ title: r.ok ? "Connected" : "Failed", description: r.ok ? "MCP server responded successfully" : `Error: ${j.error || r.statusText}`, variant: r.ok ? "default" : "destructive" });
                              } catch (e: any) {
                                setTestRes(JSON.stringify({ error: e.message }, null, 2));
                                toast({ title: "Connection Error", description: e.message, variant: "destructive" });
                              }
                            }}
                            disabled={!nk?.key && !ak?.name}
                          >
                            <Play className="h-4 w-4 mr-2 group-hover:translate-x-0.5 transition-transform" />
                            Test Connection
                          </Button>
                          {(!nk?.key && !ak?.name) && <p className="text-xs text-muted-foreground">Create an API key first</p>}
                        </div>
                        {testRes && (
                          <div className="animate-in fade-in slide-in-from-top-2">
                            <div className={`p-2 rounded-lg border text-xs font-mono max-h-60 overflow-auto whitespace-pre-wrap break-all mb-2 ${testRes.includes('"error"') ? "border-red-500/30 bg-red-500/5 text-red-300" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"}`}>
                              {testRes}
                            </div>
                            <div className={`flex items-center gap-2 text-xs ${testRes.includes('"error"') ? "text-red-400" : "text-emerald-400"}`}>
                              <div className={`h-2 w-2 rounded-full ${testRes.includes('"error"') ? "bg-red-400" : "bg-emerald-400"}`} />
                              {testRes.includes('"error"') ? "Failed" : "Connected"}
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>

                  <div>
                    <p className="text-xs font-medium mb-2 flex items-center gap-1.5">
                      <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                      Config File
                      <span className="text-muted-foreground font-normal">— place this in your {llm.name} config</span>
                    </p>
                    <div className="overflow-x-auto">
                      <TerminalBlock code={llmConfig(llm.id, nk?.key || ak?.name || "", baseUrl)} fileName="mcp-config.json" index={lli} />
                    </div>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10 anim-card card-hover" style={an(400)}>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="flex items-center gap-2 text-lg"><Grip className="h-5 w-5 text-primary shrink-0" />Available Tools</CardTitle>
          <CardDescription>All tools — <span className="text-primary">{td?.tools?.length || 0}</span> total</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 md:pt-0">
          {!td?.tools?.length ? <p className="text-sm text-muted-foreground">No tools available.</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {td.tools.map((t, ti) => (
                <div key={t.name} className={`p-3 rounded-lg border transition-all duration-200 hover:translate-y-[-2px] ${t.blocked ? "border-red-500/20 bg-red-500/5 hover:border-red-500/40" : "border-white/10 bg-white/5 hover:border-primary/30 hover:shadow-[0_4px_16px_-6px] hover:shadow-primary/10"}`} style={an(ti * 40)}>
                  <div className="flex items-center gap-2">
                    {t.blocked ? <Lock className="h-3.5 w-3.5 text-red-400 shrink-0" /> : <Zap className="h-3.5 w-3.5 text-primary shrink-0" />}
                    <code className="text-xs font-mono font-medium break-all">{t.name}</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.needsScope && <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/30 text-amber-400">scope: {t.needsScope}</Badge>}
                    {t.blocked && <Badge variant="destructive" className="text-[10px] px-1 py-0">Blocked</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-6 pt-2 pb-4 text-[11px] text-muted-foreground/40 anim-card" style={an(480)}>
        <span className="flex items-center gap-1.5"><Badge variant="outline" className="h-1.5 w-1.5 rounded-full bg-green-500/50 border-0 p-0" /> Live</span>
        <span>MCP over HTTP</span>
        <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> nodemailer</span>
        <span>{td?.tools?.length || 0} tools</span>
      </div>

      <div className="text-center anim-card" style={an(520)}>
        <a href="/developer" className="inline-flex items-center gap-2 text-xs text-primary/60 hover:text-primary transition-colors group">
          <BookOpen className="h-3.5 w-3.5" />
          <span>View full API Docs</span>
          <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </a>
      </div>
    </div>
  );
}

export default McpServerPage;
