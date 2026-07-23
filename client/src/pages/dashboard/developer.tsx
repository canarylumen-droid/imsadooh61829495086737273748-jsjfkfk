import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { Key, Copy, Check, Terminal, Loader2, RefreshCw } from "lucide-react";

type ApiKey = { id: string; name: string; permissionLevel: string; createdAt: string | null };

function ApiKeysTab() {
  const qc = useQueryClient();
  const [keyData, setKeyData] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: kd } = useQuery<{ key: ApiKey | null }>({ queryKey: ["/api/mcp/key/current"] });

  const generate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mcp/key/create", { name: "API Key", permission_level: "read_write" }).then(r => r.json()),
    onSuccess: d => {
      setKeyData({ key: d.key, name: d.name });
      toast({ title: "Key generated" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const regenerate = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/mcp/key/regenerate", { id }).then(r => r.json()),
    onSuccess: d => {
      setKeyData({ key: d.key, name: "API Key" });
      toast({ title: "Key regenerated" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const copyKey = async (t: string) => {
    try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast({ title: "Failed to copy", variant: "destructive" }); }
  };

  const displayKey = keyData?.key || (kd?.key ? `audnix_${kd.key.id?.substring(0, 4)}...${kd.key.id?.substring(kd.key.id.length - 4)}` : null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Generate an API key with full access</p>

      {keyData?.key && (
        <Card className="bg-white/5 border-emerald-500/30">
          <CardContent className="p-4 space-y-3">
            <code className="block p-3 bg-black/50 rounded-lg border border-white/10 font-mono text-xs break-all select-all">
              {keyData.key}
            </code>
            <Button size="sm" variant="outline" className="border-white/10" onClick={() => copyKey(keyData.key)}>
              {copied ? <Check className="h-4 w-4 mr-1 text-green-400" /> : <Copy className="h-4 w-4 mr-1" />}
              Copy
            </Button>
          </CardContent>
        </Card>
      )}

      {!keyData && kd?.key && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-3">
              <p className="text-xs text-muted-foreground mb-1">Current key</p>
              <code className="text-xs font-mono break-all">{displayKey}</code>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button variant="outline" size="icon" className="border-white/10 h-8 w-8" onClick={() => copyKey(displayKey || "")}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="outline" size="icon" className="border-white/10 h-8 w-8" onClick={() => { if (confirm("Regenerate?")) regenerate.mutate(kd.key!.id); }}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!keyData && !kd?.key && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">No API key yet</p>
          </CardContent>
        </Card>
      )}

      <Button onClick={() => generate.mutate()} disabled={generate.isPending} className="w-full sm:w-auto">
        {generate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Key className="h-4 w-4 mr-2" />}
        {keyData || kd?.key ? "Generate new key" : "Generate key"}
      </Button>
    </div>
  );
}

function McpTab() {
  const { data: kd } = useQuery<{ key: ApiKey | null }>({ queryKey: ["/api/mcp/key/current"] });
  const baseUrl = window.location.origin;
  const keyLabel = kd?.key ? `audnix_${kd.key.id?.substring(0, 4)}...` : "<YOUR_API_KEY>";

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">Connect AI assistants to your data via MCP</p>

      <div className="p-3 bg-black/50 rounded-lg border border-white/10">
        <p className="text-xs text-muted-foreground mb-1">Endpoint</p>
        <code className="text-xs font-mono break-all">{baseUrl}/mcp</code>
      </div>

      <div className="p-3 bg-black/50 rounded-lg border border-white/10">
        <p className="text-xs text-muted-foreground mb-1">cURL test</p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all">curl -X POST "{baseUrl}/mcp" \
  -H "Authorization: Bearer {keyLabel}" \
  -H "Content-Type: application/json" \
  -d '{{"jsonrpc":"2.0","method":"tools/list","id":1}}'</pre>
      </div>

      <div className="p-3 bg-black/50 rounded-lg border border-white/10">
        <p className="text-xs text-muted-foreground mb-1">MCP config</p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all">{"{"}
  "mcpServers": {"{"}
    "audnix": {"{"}
      "url": "{baseUrl}/mcp",
      "headers": {"{"} "Authorization": "Bearer {keyLabel}" {"}"}
    {"}"}
  {"}"}
{"}"}</pre>
      </div>
    </div>
  );
}

function DeveloperPage() {
  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6">
      <div className="flex items-center gap-2 mb-6">
        <Key className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Developer</h1>
      </div>

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-4">
          <Tabs defaultValue="api">
            <TabsList className="bg-white/5 border border-white/10 mb-4">
              <TabsTrigger value="api" className="data-[state=active]:bg-white/10">
                <Key className="h-4 w-4 mr-1.5" />
                API Keys
              </TabsTrigger>
              <TabsTrigger value="mcp" className="data-[state=active]:bg-white/10">
                <Terminal className="h-4 w-4 mr-1.5" />
                MCP
              </TabsTrigger>
            </TabsList>
            <TabsContent value="api"><ApiKeysTab /></TabsContent>
            <TabsContent value="mcp"><McpTab /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export default DeveloperPage;
