import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Shield, UserPlus, Trash2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export default function AdminSettings() {
  const [newEmail, setNewEmail] = useState("");
  const [emailToRevoke, setEmailToRevoke] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: whitelist, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/whitelist"],
  });

  const addAdminMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/api/admin/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelist"] });
      setNewEmail("");
      toast({
        title: "Admin Added",
        description: "The email has been added to the admin whitelist",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeAdminMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/admin/whitelist/${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelist"] });
      setEmailToRevoke(null);
      toast({
        title: "Admin Removed",
        description: "The admin access has been revoked",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddAdmin = () => {
    if (!newEmail || !newEmail.includes("@")) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    addAdminMutation.mutate(newEmail);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Admin Settings</h2>
          <p className="text-muted-foreground">Manage admin whitelist and system configuration</p>
        </div>

        {/* Admin Whitelist Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-600" />
              Admin Whitelist
            </CardTitle>
            <CardDescription>
              Manage who has admin access to the platform. Only whitelisted emails can access the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add New Admin */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="admin@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddAdmin()}
                  className="pl-10"
                />
              </div>
              <Button
                onClick={handleAddAdmin}
                disabled={addAdminMutation.isPending}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Add Admin
              </Button>
            </div>

            {/* Admin List */}
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {whitelist?.whitelist?.map((admin: any) => (
                    <TableRow key={admin.id}>
                      <TableCell className="font-medium">{admin.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={admin.status === "active" ? "outline" : "secondary"}
                          className={
                            admin.status === "active"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400"
                          }
                        >
                          {admin.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDistanceToNow(new Date(admin.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        {admin.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEmailToRevoke(admin.email)}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Future Features Documentation */}
        <Card>
          <CardHeader>
            <CardTitle>Planned Features</CardTitle>
            <CardDescription>
              These admin features will be added in future updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>Send notifications to all users</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>Broadcast system announcements</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>Update terms of service and privacy policy</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>Feature flags and A/B testing</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>Platform-wide analytics export</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>User impersonation for support</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={!!emailToRevoke} onOpenChange={() => setEmailToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Admin Access</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke admin access for <strong>{emailToRevoke}</strong>?
              They will immediately lose access to the admin panel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => emailToRevoke && revokeAdminMutation.mutate(emailToRevoke)}
              className="bg-red-600 hover:bg-red-700"
            >
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
