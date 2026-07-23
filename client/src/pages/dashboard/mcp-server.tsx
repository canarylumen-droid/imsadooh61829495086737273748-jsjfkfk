import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import {
  Terminal, Key, Copy, Check, Trash2, Loader2, Plus, Eye, Server,
  Play, Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageWrapper } from "@/components/ui/page-wrapper";

type ApiKey = {
  id: string;
  name: string;
  permissionLevel: string;
  createdAt: string | null;
  lastUsedAt: string | null;
};

const LLM_PROVIDERS = [
  { id: "claude", name: "Claude (Anthropic)" },
  { id: "cursor", name: "Cursor" },
  { id: "windsurf", name: "Windsurf" },
  { id: "cline", name: "Cline" },
  { id: "vscode", name: "VS Code" },
  { id: "github-copilot", name: "GitHub Copilot" },
  { id: "continue", name: "Continue" },
  { id: "openai", name: "OpenAI" },
  { id: "jetbrains", name: "JetBrains" },
  { id: "custom", name: "Custom" },
];

function McpServerPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [permLevel, setPermLevel] = useState<"read" | "read_write">("read_write");
  const [newKeyData, setNewKeyData] = useState<{ key: string; name: string } | null>(null);
  const [showFullKey, setShowFullKey] = useState(false);
  const [selLLM, setSelLLM] = useState("claude");
  const [testRes, setTestRes] = useState<string | null>(null);

  const { data: keysData, isLoading } = useQuery<{ keys: ApiKey[] }>({
    queryKey: ["/api/mcp/keys"],
  });

  const keys = keysData?.keys || [];
  const baseUrl = window.location.origin;

  const createKey = useMutation({
    mutationFn: (d: { name: string; permissionLevel: string }) =>
      apiRequest("POST", "/api/mcp/key/create", d).then(async r => {
        if (!r.ok) { const err = await r.json(); throw new Error(err.error || "Failed to create key"); }
        return r.json();
      }),
    onSuccess: (d) => {
      setNewKeyData({ key: d.key, name: d.name });
      setShowFullKey(true);
      setDialogOpen(false);
      setCreateName("");
      toast({ title: "API key created" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create key", description: e.message, variant: "destructive" }),
  });

  const deleteKey = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/mcp/key/${id}`),
    onSuccess: () => { toast({ title: "Key deleted" }); qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] }); },
    onError: (e: Error) => toast({ title: "Failed to delete key", description: e.message, variant: "destructive" }),
  });

  const copyText = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast({ title: "Copied" }); }
    catch { toast({ title: "Failed to copy", variant: "destructive" }); }
  };

  const keyForDisplay = keys[0]?.id ? `audnix_${keys[0].id.substring(0, 4)}...` : "<YOUR_API_KEY>";

  return (
    <PageWrapper className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP Server</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Model Context Protocol — API keys and configuration</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Name your key and set the permission level.</DialogDescription>
            </DialogHeader>
            <div className="py-3 space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="My API key" className="mt-1.5" />
              </div>
              <div>
                <Label>Permission</Label>
                <div className="flex gap-2 mt-1.5">
                  <Button
                    variant={permLevel === "read_write" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPermLevel("read_write")}
                  >
                    Read/Write
                  </Button>
                  <Button
                    variant={permLevel === "read" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPermLevel("read")}
                  >
                    Read Only
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button
                onClick={() => createKey.mutate({ name: createName || "My API key", permissionLevel: permLevel })}
                disabled={createKey.isPending || !createName.trim()}
              >
                {createKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Generate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {newKeyData && showFullKey && (
        <Card className="border-emerald-500/30">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Key className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-emerald-300">{newKeyData.name}</p>
                <p className="text-sm text-muted-foreground mb-3">Copy this key now. You won't see it again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2.5 bg-black/50 rounded-lg border font-mono text-sm break-all select-all">
                    {newKeyData.key}
                  </code>
                  <Button onClick={() => copyText(newKeyData.key)}>
                    <Copy className="h-4 w-4 mr-2" /> Copy
                  </Button>
                </div>
              </div>
              <button onClick={() => setShowFullKey(false)} className="text-muted-foreground hover:text-foreground mt-1">
                <Eye className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                    No API keys yet. Create one above to use MCP.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map(k => (
                  <TableRow key={k.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      <code className="text-xs font-mono text-muted-foreground">
                        {k.id ? `audnix_${k.id.substring(0, 4)}...${k.id.slice(-4)}` : "—"}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={k.permissionLevel === "read_only" ? "secondary" : "default"} className="text-[10px]">
                        {k.permissionLevel === "read_only" ? "Read" : "Read/Write"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.createdAt ? formatDistanceToNow(new Date(k.createdAt), { addSuffix: true }) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true }) : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => { if (confirm("Delete this key?")) deleteKey.mutate(k.id); }}
                        disabled={deleteKey.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              Endpoint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-muted rounded border font-mono text-xs md:text-sm break-all">{baseUrl}/mcp</code>
              <Button variant="outline" size="icon" onClick={() => copyText(`${baseUrl}/mcp`)}>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={async () => {
                setTestRes(null);
                try {
                  const apiKey = keys[0]?.id;
                  if (!apiKey) { toast({ title: "No API key", description: "Create a key first", variant: "destructive" }); return; }
                  const r = await fetch("/mcp", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
                  });
                  const j = await r.json();
                  setTestRes(r.ok ? `Connected — ${j.result?.tools?.length || 0} tools available` : `Error: ${j.error?.message || r.statusText}`);
                  toast({ title: r.ok ? "Connected" : "Failed", variant: r.ok ? "default" : "destructive" });
                } catch (e: any) {
                  setTestRes(`Error: ${e.message}`);
                  toast({ title: "Connection error", variant: "destructive" });
                }
              }}
            >
              Test connection
            </Button>
            {testRes && (
              <div className={`text-xs p-2 rounded border ${testRes.startsWith("Connected") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-600"}`}>
                {testRes}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={selLLM} onValueChange={setSelLLM}>
            <div className="overflow-x-auto -mx-1 pb-1">
              <TabsList className="inline-flex h-auto gap-1 bg-transparent mb-4 min-w-max px-1">
                {LLM_PROVIDERS.map(p => (
                  <TabsTrigger key={p.id} value={p.id}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-transparent data-[state=active]:bg-primary/10 data-[state=active]:border-primary/30 hover:bg-muted/50 transition-all"
                  >
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {LLM_PROVIDERS.map(p => (
              <TabsContent key={p.id} value={p.id}>
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Add this to your MCP client config:</p>
                  <div className="relative group rounded-lg overflow-hidden border bg-[#0d1117]">
                    <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-white/5">
                      <span className="text-[10px] text-gray-400 font-mono">{p.name}</span>
                      <button
                        onClick={() => copyText(getConfig(p.id, baseUrl, keyForDisplay))}
                        className="h-7 w-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                      >
                        <Copy className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                    </div>
                    <pre className="p-4 overflow-x-auto">
                      <code className="text-xs font-mono leading-5 text-gray-200 whitespace-pre">{getConfig(p.id, baseUrl, keyForDisplay)}</code>
                    </pre>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </PageWrapper>
  );
}

function getConfig(llmId: string, baseUrl: string, keyLabel: string): string {
  const k = keyLabel;
  const cfg = `"mcpServers": {\n    "audnix": {\n      "url": "${baseUrl}/mcp",\n      "headers": { "Authorization": "Bearer ${k}" }\n    }\n  }`;
  const map: Record<string, string> = {
    claude: `{\n  ${cfg}\n}`,
    cursor: `// ~/.cursor/mcp.json\n{\n  ${cfg}\n}`,
    windsurf: `// ~/.windsurf/mcp_config.json\n{\n  ${cfg}\n}`,
    cline: `// cline_mcp_settings.json\n{\n  ${cfg}\n}`,
    "github-copilot": `// ~/.github/copilot/mcp.json\n{\n  ${cfg}\n}`,
    "vscode": `// ~/.vscode/mcp.json\n{\n  ${cfg}\n}`,
    "continue": `// ~/.continue/config.json\n{\n  "experimental": {\n    ${cfg}\n  }\n}`,
    "openai": `{\n  "mcp_server": { "name": "audnix", "endpoint": "${baseUrl}/mcp", "api_key": "${k}" }\n}`,
    "jetbrains": `# Toolbox → MCP Servers\nurl: ${baseUrl}/mcp\nheaders:\n  Authorization: "Bearer ${k}"`,
    "custom": `${cfg}`,
  };
  return map[llmId] || map.custom;
}

export default McpServerPage;
