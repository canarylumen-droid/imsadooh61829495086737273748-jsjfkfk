import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageWrapper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6 space-y-4 animate-in fade-in duration-500", className)}>
      {children}
    </div>
  );
}
