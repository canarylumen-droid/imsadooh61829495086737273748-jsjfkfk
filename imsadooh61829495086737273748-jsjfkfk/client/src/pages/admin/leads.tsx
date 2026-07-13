import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import OutreachConfigModal from "@/components/outreach/OutreachConfigModal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Filter } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { LeadStatus, ChannelType } from "@shared/types";

interface AdminLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  channel: ChannelType;
  status: LeadStatus;
  score: number;
  createdAt: string;
  lastMessageAt: string | null;
}

interface AdminUser {
  name: string | null;
  email: string | null;
}

interface AdminLeadItem {
  lead: AdminLead;
  user: AdminUser | null;
}

interface AdminLeadsPagination {
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}

interface AdminLeadsResponse {
  leads: AdminLeadItem[];
  pagination: AdminLeadsPagination;
}

export default function AdminLeads() {
  const [page, setPage] = useState(1);

  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);

  const toggleSelectAll = (checked: boolean) => {
    if (checked && leadsData?.leads) {
      setSelectedLeads(leadsData.leads.map(l => l.lead.id));
    } else {
      setSelectedLeads([]);
    }
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedLeads(prev => [...prev, id]);
    } else {
      setSelectedLeads(prev => prev.filter(lid => lid !== id));
    }
  };

  const { data: leadsData, isLoading } = useQuery<AdminLeadsResponse>({
    queryKey: ["/api/admin/leads", { page, status, channel }],
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "converted":
        return "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400";
      case "new":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400";
      case "open":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
      case "replied":
        return "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400";
      case "not_interested":
        return "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400";
    }
  };

  const getChannelColor = (channel: string) => {
    switch (channel) {
      case "instagram":
        return "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400";
      case "email":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400";
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">All Leads</h2>
          <p className="text-muted-foreground">Monitor all leads across the platform (read-only)</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="flex gap-2 flex-1">
                {selectedLeads.length > 0 && (
                  <Button onClick={() => setIsCampaignModalOpen(true)} className="mr-2">
                    Start Campaign ({selectedLeads.length})
                  </Button>
                )}
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Status</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="replied">Replied</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                    <SelectItem value="not_interested">Not Interested</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="All Channels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Channels</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(status || channel) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStatus("");
                    setChannel("");
                  }}
                >
                  Clear Filters
                </Button>
              )}
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
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={(leadsData?.leads?.length || 0) > 0 && selectedLeads.length === (leadsData?.leads?.length || 0)}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leadsData?.leads?.map((item: AdminLeadItem) => (
                      <TableRow key={item.lead.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedLeads.includes(item.lead.id)}
                            onCheckedChange={(c) => toggleSelectOne(item.lead.id, !!c)}
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.lead.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {item.lead.email || item.lead.phone || "No contact"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{item.user?.name || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">{item.user?.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getChannelColor(item.lead.channel)}>
                            {item.lead.channel}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(item.lead.status)}>
                            {item.lead.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-12 bg-secondary rounded-full h-2">
                              <div
                                className="bg-primary h-2 rounded-full"
                                style={{ width: `${Math.min(100, item.lead.score)}%` }}
                              />
                            </div>
                            <span className="text-sm">{item.lead.score}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDistanceToNow(new Date(item.lead.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.lead.lastMessageAt
                            ? formatDistanceToNow(new Date(item.lead.lastMessageAt), { addSuffix: true })
                            : "Never"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {leadsData?.pagination && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {leadsData.leads?.length || 0} of {leadsData.pagination.total} leads
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
                        disabled={page >= leadsData.pagination.totalPages}
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

        <OutreachConfigModal
          isOpen={isCampaignModalOpen}
          onClose={() => setIsCampaignModalOpen(false)}
          leads={leadsData?.leads
            .filter(item => selectedLeads.includes(item.lead.id))
            .map(item => ({
              id: item.lead.id,
              name: item.lead.name,
              email: item.lead.email || "",
              company: "" // Admin view doesn't show company name directly in list, but we can pass placeholder or fetch if needed
            })) || []
          }
        />
      </div>
    </AdminLayout>
  );
}
