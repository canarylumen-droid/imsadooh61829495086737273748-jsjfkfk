import { useState, useEffect } from "react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { Key, Copy, Check, Trash2, Loader2, Plus, Eye, EyeOff, Shield, Pencil, X } from "lucide-react";
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
  const { socket } = useRealtime();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPermission, setCreatePermission] = useState("read_write");
  const [newKeyData, setNewKeyData] = useState<{ key: string; name: string; permissionLevel: string } | null>(null);
  const [showFullKey, setShowFullKey] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const handler = () => qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] });
    socket.on("keys_updated", handler);
    return () => { socket.off("keys_updated", handler); };
  }, [socket, qc]);

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
      setNewKeyData({ key: d.key, name: d.name, permissionLevel: d.permissionLevel || createPermission });
      setShowFullKey(true);
      setDialogOpen(false);
      setCreateName("");
      setCreatePermission("read_write");
      toast({ title: "API key created" });
      qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create key", description: e.message, variant: "destructive" }),
  });

  const renameKey = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest("PATCH", `/api/mcp/key/${id}`, { name }).then(async r => {
        if (!r.ok) { const err = await r.json(); throw new Error(err.error || "Failed to rename"); }
        return r.json();
      }),
    onSuccess: () => {
      toast({ title: "Key renamed" });
      setRenameTarget(null);
      qc.invalidateQueries({ queryKey: ["/api/mcp/keys"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to rename", description: e.message, variant: "destructive" }),
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
              <DialogDescription>Name your key and choose its permission level.</DialogDescription>
            </DialogHeader>
            <div className="py-3 space-y-4">
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
                <Select value={createPermission} onValueChange={setCreatePermission}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read_only">
                      <span className="flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5 text-sky-500" />
                        Read only — can view data
                      </span>
                    </SelectItem>
                    <SelectItem value="read_write">
                      <span className="flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5 text-amber-500" />
                        Read & Write — can view and modify data
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={() => createKey.mutate({
                  name: createName || "My API key",
                  permission_level: createPermission,
                })}
                disabled={createKey.isPending || !createName.trim()}
              >
                {createKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Generate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* API Key reveal modal — shows full key once, then gone */}
      <Dialog open={showFullKey && !!newKeyData} onOpenChange={(open) => { if (!open) setShowFullKey(false); }}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-emerald-500" />
              Your API Key
            </DialogTitle>
            <DialogDescription>
              Copy this key now. <strong>You won't be able to see it again</strong> for security reasons.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">{newKeyData?.name}</span>
              <Badge variant="outline" className="text-[9px]">
                {newKeyData?.permissionLevel === "read_only" ? "Read only" : "Read & Write"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <code className="flex-1 p-3 bg-muted rounded-xl border font-mono text-xs break-all select-all">
                {newKeyData?.key}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="rounded-xl shrink-0 h-11 w-11"
                onClick={() => {
                  if (newKeyData?.key) copyKey(newKeyData.key);
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                    setShowFullKey(false);
                    setNewKeyData(null);
                  }, 1200);
                }}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
              <Shield className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                Treat this like a password. Never share it or commit it to code.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              className="w-full"
              onClick={() => {
                if (newKeyData?.key) copyKey(newKeyData.key);
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                  setShowFullKey(false);
                  setNewKeyData(null);
                }, 1200);
              }}
            >
              {copied ? <><Check className="h-4 w-4 mr-2 text-emerald-500" /> Copied</> : <><Copy className="h-4 w-4 mr-2" /> Copy & Close</>}
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
                <TableHead className="w-20" />
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
                        audnix_{k.id?.substring(0, 4)}...{k.id?.slice(-4)}
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
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => { setRenameTarget({ id: k.id, name: k.name }); setRenameName(k.name); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => { if (confirm(`Delete "${k.name}"?`)) deleteKey.mutate(k.id); }}
                          disabled={deleteKey.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename API key</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Label>Name</Label>
            <Input value={renameName} onChange={e => setRenameName(e.target.value)} className="mt-1.5" />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={() => renameTarget && renameKey.mutate({ id: renameTarget.id, name: renameName })} disabled={renameKey.isPending || !renameName.trim()}>
              {renameKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}

export default DeveloperPage;
