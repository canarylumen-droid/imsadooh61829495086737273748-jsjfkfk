import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import {
  Key, Copy, Check, RotateCcw, Eye, EyeOff, Trash2, Loader2, Plus,
} from "lucide-react";

type ApiKey = { id: string; name: string; permissionLevel: string; scopes: string[]; isActive: boolean; createdAt: string | null; lastUsedAt: string | null };

function DeveloperPage() {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [createPerm, setCreatePerm] = useState<"read" | "read_write">("read_write");

  const { data: kd, isLoading } = useQuery<{ key: ApiKey | null }>({ queryKey: ["/api/mcp/key/current"] });
  const ak = kd?.key ?? null;

  const ck = useMutation({
    mutationFn: (d: { name: string; permission_level: string }) => apiRequest("POST", "/api/mcp/key/create", d).then(r => r.json()),
    onSuccess: d => {
      setNewKey({ key: d.key, name: d.name });
      toast({ title: "API key created" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] });
    },
    onError: (e: Error) => toast({ title: "Failed to create key", description: e.message, variant: "destructive" }),
  });

  const rk = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/mcp/key/regenerate", { id }).then(r => r.json()),
    onSuccess: d => {
      setNewKey({ key: d.key, name: ak?.name || "API Key" });
      toast({ title: "Key regenerated" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/key/current"] });
    },
    onError: (e: Error) => toast({ title: "Failed to regenerate", description: e.message, variant: "destructive" }),
  });

  const copyKey = async (t: string) => {
    try { await navigator.clipboard.writeText(t); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000); }
    catch { toast({ title: "Failed to copy", variant: "destructive" }); }
  };

  const maskedKey = newKey?.key
    ? newKey.key
    : ak
    ? `audnix_${ak.id?.substring(0, 4)}...${ak.id?.substring(ak.id.length - 4)}`
    : null;

  const displayKey = showKey && maskedKey ? maskedKey : maskedKey?.replace(/[^-]/g, "*") || null;

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Key className="h-6 w-6 text-primary" />
          API Keys
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Generate and manage API keys</p>
      </div>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg">Create new key</CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="flex-1">
              <Label className="text-xs mb-1.5 block">Name</Label>
              <Input
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                className="bg-white/5 border-white/10"
                placeholder="My API Key"
              />
            </div>
            <div className="w-full sm:w-40">
              <Label className="text-xs mb-1.5 block">Permission</Label>
              <Select value={createPerm} onValueChange={(v: "read" | "read_write") => setCreatePerm(v)}>
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read only</SelectItem>
                  <SelectItem value="read_write">Read & write</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => ck.mutate({ name: createName || "My API Key", permission_level: createPerm })}
              disabled={ck.isPending}
              className="w-full sm:w-auto"
            >
              {ck.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>

      {newKey?.key && (
        <Card className="bg-white/5 border-emerald-500/30">
          <CardContent className="p-4 md:p-6 space-y-3">
            <div className="flex items-start gap-2">
              <Key className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-300">New key: {newKey.name}</p>
                <code className="block p-3 bg-black/50 rounded-lg border border-white/10 font-mono text-xs md:text-sm break-all select-all mt-2">
                  {newKey.key}
                </code>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-white/10"
                onClick={() => copyKey(newKey.key)}
              >
                {keyCopied ? <Check className="h-4 w-4 mr-1 text-green-400" /> : <Copy className="h-4 w-4 mr-1" />}
                Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {ak && !newKey?.key && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg">Active key</CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0 md:pt-0 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{ak.name}</p>
                <p className="text-xs text-muted-foreground">
                  Created {ak.createdAt ? new Date(ak.createdAt).toLocaleDateString() : "N/A"}
                  {ak.lastUsedAt && ` · Used ${new Date(ak.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              <Badge variant={ak.permissionLevel === "read_only" ? "secondary" : "default"}>
                {ak.permissionLevel === "read_only" ? "Read" : "Read/Write"}
              </Badge>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <code className="flex-1 p-3 bg-black/50 rounded-lg border border-white/10 font-mono text-xs md:text-sm break-all select-all">
                {displayKey}
              </code>
              <div className="flex gap-1 self-end sm:self-auto">
                <Button variant="outline" size="icon" className="border-white/10" onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" className="border-white/10" onClick={() => copyKey(maskedKey || "")}>
                  {keyCopied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-white/10 hover:border-amber-500/30 hover:text-amber-400"
                  onClick={() => { if (confirm("Regenerate? Old key stops working immediately.")) rk.mutate(ak.id); }}
                  disabled={rk.isPending}
                >
                  {rk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!ak && !newKey && !isLoading && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4 md:p-6">
            <p className="text-sm text-muted-foreground">No API keys yet. Generate one above.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DeveloperPage;
