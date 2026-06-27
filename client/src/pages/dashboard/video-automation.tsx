import { Construction } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageWrapper } from "@/components/ui/page-wrapper";

export default function VideoAutomationPage() {
  return (
    <PageWrapper>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-12 text-center max-w-md border-dashed border-muted-foreground/30">
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-full bg-muted">
              <Construction className="w-12 h-12 text-muted-foreground" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-3">Coming Soon</h2>
          <p className="text-muted-foreground">
            Video Automation is being rebuilt and will be available soon.
          </p>
        </Card>
      </div>
    </PageWrapper>
  );
}
