import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { Key, Copy, Check, Trash2, Loader2, Plus, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageWrapper } from "@/components/ui/page-wrapper";

type ApiKey = {
  id: string;
  name: string;
  permissionLevel: string;
  createdAt: string | null;
  lastUsedAt: string | null;
};

function DeveloperPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [newKeyData, setNewKeyData] = useState<{ key: string; name: string; permissionLevel: string } | null>(null);
  const [showFullKey, setShowFullKey] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState("read_write");

  const { data: keysData, isLoading } = useQuery<{ keys: ApiKey[] }>({
    queryKey: ["/api/mcp/keys"],
  });

  const keys = keysData?.keys || [];

  const createKey = useMutation({
    mutationFn: (d: { name: string; permission_level: string }) =>
      apiRequest("POST", "/api/mcp/key/create", d).then(async r => {
        if (!r.ok) {
          const err = await r.json();
          throw new Error(err.error || "Failed to create key");
        }
        return r.json();
      }),
    onSuccess: (d) => {
      setNewKeyData({ key: d.key, name: d.name, permissionLevel: d.permissionLevel || permissionLevel });
      setShowFullKey(true);
      setDialogOpen(false);
      setCreateName("");
      setPermissionLevel("read_write");
      toast({ title: "API key created" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create key", description: e.message, variant: "destructive" }),
  });

  const deleteKey = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/mcp/key/${id}`),
    onSuccess: () => {
      toast({ title: "Key deleted" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to delete key", description: e.message, variant: "destructive" }),
  });

  const copyKey = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const maskedKey = newKeyData?.key
    ? `${newKeyData.key.substring(0, 12)}...${newKeyData.key.slice(-4)}`
    : null;

  return (
    <PageWrapper className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Generate and manage API keys</p>
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
              <DialogDescription>Name your key and we'll generate one for you.</DialogDescription>
            </DialogHeader>
            <div className="py-3 space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="My API key"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Permission</Label>
                <Select value={permissionLevel} onValueChange={setPermissionLevel}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read_only">Read only — only GET endpoints</SelectItem>
                    <SelectItem value="read_write">Read/Write — all operations except account deletion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={() => createKey.mutate({ name: createName || "My API key", permission_level: permissionLevel })}
                disabled={createKey.isPending || !createName.trim()}
              >
                {createKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Generate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={newKeyData !== null && showFullKey} onOpenChange={(open) => { if (!open) { setShowFullKey(false); setNewKeyData(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-emerald-400" />
              {newKeyData?.name}
            </DialogTitle>
            <DialogDescription>
              Copy this key now. You won't be able to see it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <code className="flex-1 font-mono text-sm break-all select-all">
                {newKeyData?.key}
              </code>
              <Button size="sm" variant="outline" onClick={() => { if (newKeyData) copyKey(newKeyData.key); }}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Permission: <Badge variant="secondary" className="text-[10px] ml-1">{newKeyData?.permissionLevel === "read_only" ? "Read only" : "Read/Write"}</Badge>
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => { if (newKeyData) copyKey(newKeyData.key); setNewKeyData(null); setShowFullKey(false); }}>
              <Check className="h-4 w-4 mr-2" />
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    No API keys yet.
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
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
    </PageWrapper>
  );
}

export default DeveloperPage;
