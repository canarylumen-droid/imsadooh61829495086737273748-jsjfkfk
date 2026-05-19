import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageWrapper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6 animate-in fade-in duration-500", className)}>
      {children}
    </div>
  );
}
