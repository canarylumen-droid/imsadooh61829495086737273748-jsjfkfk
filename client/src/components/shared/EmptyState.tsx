
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description: string;
    action?: React.ReactNode;
    className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in-95 duration-500 h-full min-h-[300px]", className)}>
            <div className="h-20 w-20 rounded-[2rem] bg-gradient-to-br from-muted/20 to-muted/5 border border-white/5 flex items-center justify-center mb-6 shadow-xl shadow-black/5 transition-transform hover:scale-105 duration-500">
                <Icon className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground mb-2">{title}</h3>
            <p className="text-base text-muted-foreground max-w-sm mb-8 font-medium leading-relaxed">{description}</p>
            {action && (
                <div className="animate-in slide-in-from-bottom-2 fade-in duration-700 delay-100">
                    {action}
                </div>
            )}
        </div>
    );
}
