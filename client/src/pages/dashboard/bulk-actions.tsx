
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Users, MessageSquare, Tag, Archive } from "lucide-react";
import { PageWrapper } from "@/components/ui/page-wrapper";

export default function BulkActionsPage() {
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);

  return (
    <PageWrapper>
      <div>
        <h1 className="text-3xl font-bold">Bulk Actions</h1>
        <p className="text-muted-foreground">Manage multiple leads at once</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Selected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{selectedLeads.length}</div>
          </CardContent>
        </Card>

        <Button variant="outline" className="h-auto flex-col items-start p-4">
          <MessageSquare className="h-5 w-5 mb-2" />
          <span className="font-semibold">Send Broadcast</span>
          <span className="text-xs text-muted-foreground">Voice or text message</span>
        </Button>

        <Button variant="outline" className="h-auto flex-col items-start p-4">
          <Tag className="h-5 w-5 mb-2" />
          <span className="font-semibold">Bulk Tag</span>
          <span className="text-xs text-muted-foreground">Add/remove tags</span>
        </Button>

        <Button variant="outline" className="h-auto flex-col items-start p-4">
          <Archive className="h-5 w-5 mb-2" />
          <span className="font-semibold">Archive</span>
          <span className="text-xs text-muted-foreground">Move to archive</span>
        </Button>
      </div>
    </PageWrapper>
  );
}
