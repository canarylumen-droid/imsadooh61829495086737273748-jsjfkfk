import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Eye, Mail, Calendar, CreditCard, Crown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  role: string;
  createdAt: string;
  lastLogin: string | null;
  stripeCustomerId: string | null;
}

interface UserLead {
  id: string;
  name: string;
  channel: string;
  status: string;
}

interface UserIntegration {
  id: string;
  provider: string;
  connected: boolean;
  lastSync: string | null;
}

interface UsersListResponse {
  users: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface UserDetails {
  user: User;
  leads: UserLead[];
  integrations: UserIntegration[];
  stats: {
    leads: { total: number; converted: number; new: number; open: number };
    messages: { total: number; received: number; sent: number };
  };
}

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [upgradePlan, setUpgradePlan] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: usersData, isLoading } = useQuery<UsersListResponse>({
    queryKey: ["/api/admin/users", { search, page }],
  });

  const { data: userDetails } = useQuery<UserDetails>({
    queryKey: [`/api/admin/users/${selectedUser}`],
    enabled: !!selectedUser,
  });

  const upgradeMutation = useMutation({
    mutationFn: async ({ userId, plan }: { userId: string; plan: string }) => {
      const res = await fetch(`/api/admin/users/${userId}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to upgrade user');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "User Upgraded!",
        description: `${data.user.email} is now on ${data.user.newPlan} plan`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/users/${selectedUser}`] });
      setUpgradePlan("");
    },
    onError: (error: Error) => {
      toast({
        title: "Upgrade Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getPlanBadgeColor = (plan: string) => {
    switch (plan) {
      case "enterprise":
        return "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400";
      case "pro":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400";
      case "starter":
        return "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400";
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">User Management</h2>
          <p className="text-muted-foreground">View and search all users</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email, name, or username..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button variant="outline">Filters</Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersData?.users?.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{user.name || "No name"}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getPlanBadgeColor(user.plan)}>
                            {user.plan}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === "admin" ? "destructive" : "secondary"}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          {user.lastLogin 
                            ? formatDistanceToNow(new Date(user.lastLogin), { addSuffix: true })
                            : "Never"}
                        </TableCell>
                        <TableCell>
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => setSelectedUser(user.id)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {usersData?.pagination && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {usersData.users?.length || 0} of {usersData.pagination.total} users
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= usersData.pagination.totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* User Details Dialog */}
        <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>User Details</DialogTitle>
            </DialogHeader>
            {userDetails && (
              <div className="space-y-6">
                {/* User Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-1" />
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p className="font-medium">{userDetails.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-muted-foreground mt-1" />
                    <div>
                      <p className="text-sm text-muted-foreground">Member Since</p>
                      <p className="font-medium">
                        {new Date(userDetails.user.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CreditCard className="w-5 h-5 text-muted-foreground mt-1" />
                    <div>
                      <p className="text-sm text-muted-foreground">Stripe Customer</p>
                      <p className="font-medium">
                        {userDetails.user.stripeCustomerId || "No customer ID"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">{userDetails.stats.leads.total}</p>
                        <p className="text-sm text-muted-foreground">Total Leads</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">{userDetails.stats.leads.converted}</p>
                        <p className="text-sm text-muted-foreground">Converted</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold">{userDetails.stats.messages.total}</p>
                        <p className="text-sm text-muted-foreground">Messages</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Direct Plan Upgrade */}
                <div className="border-2 border-dashed border-primary/30 rounded-lg p-4 bg-primary/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Crown className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold">Direct Plan Upgrade</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Upgrade this user to any plan without payment (for team members, promotions, testing)
                  </p>
                  <div className="flex gap-3">
                    <Select value={upgradePlan} onValueChange={setUpgradePlan}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select plan..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="starter">Starter ($49.99)</SelectItem>
                        <SelectItem value="pro">Pro ($99.99)</SelectItem>
                        <SelectItem value="enterprise">Enterprise ($199.99)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => {
                        if (selectedUser && upgradePlan) {
                          upgradeMutation.mutate({ userId: selectedUser, plan: upgradePlan });
                        }
                      }}
                      disabled={!upgradePlan || upgradeMutation.isPending}
                    >
                      {upgradeMutation.isPending ? "Upgrading..." : "Upgrade Now"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Current plan: <Badge variant="outline" className={getPlanBadgeColor(userDetails.user.plan)}>{userDetails.user.plan}</Badge>
                  </p>
                </div>

                {/* Integrations */}
                <div>
                  <h3 className="font-semibold mb-3">Integrations</h3>
                  <div className="space-y-2">
                    {userDetails.integrations.map((integration) => (
                      <div key={integration.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium capitalize">{integration.provider}</p>
                          <p className="text-sm text-muted-foreground">
                            {integration.lastSync 
                              ? `Last sync: ${formatDistanceToNow(new Date(integration.lastSync), { addSuffix: true })}`
                              : "Never synced"}
                          </p>
                        </div>
                        <Badge variant={integration.connected ? "outline" : "secondary"}>
                          {integration.connected ? "Connected" : "Disconnected"}
                        </Badge>
                      </div>
                    ))}
                    {userDetails.integrations.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No integrations connected
                      </p>
                    )}
                  </div>
                </div>

                {/* Recent Leads */}
                <div>
                  <h3 className="font-semibold mb-3">Recent Leads</h3>
                  <div className="space-y-2">
                    {userDetails.leads.slice(0, 5).map((lead) => (
                      <div key={lead.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{lead.name}</p>
                          <p className="text-sm text-muted-foreground">{lead.channel}</p>
                        </div>
                        <Badge variant="outline">{lead.status}</Badge>
                      </div>
                    ))}
                    {userDetails.leads.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No leads yet
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
