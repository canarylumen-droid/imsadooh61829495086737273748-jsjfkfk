import React from "react";
import { motion } from "framer-motion";
import { Check, Circle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProcessStep {
    id: string;
    label: string;
    description: string;
    status: "completed" | "current" | "pending";
}

interface ProcessMapProps {
    status: string;
    className?: string;
}

export const ProcessMap: React.FC<ProcessMapProps> = ({ status, className }) => {
    const steps: ProcessStep[] = [
        {
            id: "discovery",
            label: "Discovery",
            description: "Lead identified and imported",
            status: "completed",
        },
        {
            id: "outreach",
            label: "Outreach",
            description: "Initial message sent",
            status: ["open", "replied", "warm", "booked", "converted"].includes(status) ? "completed" : "current",
        },
        {
            id: "engagement",
            label: "Engagement",
            description: "Active conversation",
            status: ["replied", "warm", "booked", "converted"].includes(status) ? "completed" :
                ["open"].includes(status) ? "current" : "pending",
        },
        {
            id: "conversion",
            label: "Conversion",
            description: "Goal achieved",
            status: ["booked", "converted"].includes(status) ? "completed" :
                ["replied", "warm"].includes(status) ? "current" : "pending",
        },
    ];

    return (
        <div className={cn("relative flex justify-between items-start w-full py-8", className)}>
            {/* Background Line */}
            <div className="absolute top-[42px] left-[10%] right-[10%] h-[2px] bg-border/30 z-0" />

            {/* Active Line Progress */}
            <motion.div
                className="absolute top-[42px] left-[10%] h-[2px] bg-primary z-0 origin-left"
                initial={{ scaleX: 0 }}
                animate={{
                    scaleX: steps.filter(s => s.status === "completed").length / (steps.length - 1)
                }}
                transition={{ duration: 1, ease: "easeInOut" }}
                style={{ width: "80%" }}
            />

            {steps.map((step, index) => (
                <div key={step.id} className="relative z-10 flex flex-col items-center w-1/4 group">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: index * 0.1 }}
                        className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center border-2 transition-all duration-500",
                            step.status === "completed" ? "bg-primary border-primary text-primary-foreground shadow-[0_0_20px_rgba(var(--primary),0.3)]" :
                                step.status === "current" ? "bg-background border-primary text-primary animate-pulse" :
                                    "bg-background border-border text-muted-foreground"
                        )}
                    >
                        {step.status === "completed" ? (
                            <Check className="h-6 w-6" />
                        ) : (
                            <span className="text-sm font-bold">{index + 1}</span>
                        )}
                    </motion.div>

                    <div className="mt-4 text-center px-2">
                        <p className={cn(
                            "text-[10px] font-black uppercase tracking-[0.2em] mb-1",
                            step.status !== "pending" ? "text-foreground" : "text-muted-foreground/40"
                        )}>
                            {step.label}
                        </p>
                        <p className="text-[9px] text-muted-foreground/60 leading-tight hidden md:block">
                            {step.description}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
};
