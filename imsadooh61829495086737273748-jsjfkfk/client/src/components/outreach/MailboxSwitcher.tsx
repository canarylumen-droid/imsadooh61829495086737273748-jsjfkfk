import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Mail, CheckCircle2, PlusCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useMailbox } from "@/hooks/use-mailbox";

interface MailboxSwitcherProps {
    className?: string;
    value?: string;
    onValueChange?: (value: string | undefined) => void;
}

export function MailboxSwitcher({ className, value, onValueChange }: MailboxSwitcherProps) {
    const { selectedMailboxId, setSelectedMailboxId } = useMailbox();

    // Use controlled value if provided, otherwise fallback to hook state
    const currentMailboxId = value !== undefined ? value : selectedMailboxId;
    const handleMailboxChange = (val: string | undefined) => {
        if (onValueChange) {
            onValueChange(val);
        } else {
            setSelectedMailboxId(val);
        }
    };
    const [, setLocation] = useLocation();
    const { data: integrations, isLoading } = useQuery<any[]>({
        queryKey: ["/api/integrations"],
        select: (data: any) => data.integrations || [],
    });

    const [mailboxSearch, setMailboxSearch] = useState("");
    const MAILBOX_DISPLAY_LIMIT = 50;

    const mailboxes = useMemo(() => (
        integrations?.filter(i => ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected) || []
    ), [integrations]);

    const filteredMailboxes = useMemo(() => {
        if (!mailboxSearch.trim()) return mailboxes;
        const q = mailboxSearch.toLowerCase();
        return mailboxes.filter(m =>
            (m.email || "").toLowerCase().includes(q) ||
            (m.accountType || "").toLowerCase().includes(q) ||
            (m.provider || "").toLowerCase().includes(q)
        );
    }, [mailboxes, mailboxSearch]);

    const visibleMailboxes = filteredMailboxes.slice(0, MAILBOX_DISPLAY_LIMIT);
    const hiddenCount = filteredMailboxes.length - visibleMailboxes.length;

    // Auto-select first mailbox if none is selected and mailboxes exist
    useEffect(() => {
        if (!currentMailboxId && mailboxes.length > 0) {
            handleMailboxChange(mailboxes[0].id);
        }
    }, [currentMailboxId, mailboxes]);

    if (isLoading) return <div className="h-10 w-[200px] animate-pulse bg-muted rounded-2xl" />;

    // Always show if user has at least one connected mailbox, so they can see "All" vs specific
    if (mailboxes.length === 0) return null;

    const selectedMailbox = mailboxes.find(m => m.id === currentMailboxId) || mailboxes[0];

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <Select
                value={currentMailboxId || (mailboxes[0]?.id)}
                onValueChange={(val) => {
                    if (val === "add_new") {
                        setLocation("/dashboard/integrations");
                        return;
                    }
                    handleMailboxChange(val);
                }}
            >
                <SelectTrigger className="w-[280px] h-11 rounded-2xl border-border/40 bg-card/40 backdrop-blur-md font-bold text-[11px] uppercase tracking-wider text-muted-foreground/80 hover:text-foreground transition-all group shadow-sm hover:shadow-primary/5">
                    <div className="flex items-center gap-2.5 truncate">
                        <div className="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                            <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                        </div>
                        <SelectValue>
                            {selectedMailbox?.accountType || selectedMailbox?.email || (selectedMailbox?.provider === 'custom_email' ? 'Custom Email' : selectedMailbox?.provider) || "Switch Mailbox"}
                        </SelectValue>
                    </div>
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-border/40 bg-card/95 backdrop-blur-xl shadow-2xl min-w-[280px] p-2">
                    {mailboxes.length > 5 && (
                        <div className="px-2 pb-2">
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/30 border border-border/20">
                                <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                                <input
                                    className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none"
                                    placeholder="Search mailboxes..."
                                    value={mailboxSearch}
                                    onChange={e => setMailboxSearch(e.target.value)}
                                    onKeyDown={e => e.stopPropagation()}
                                    onClick={e => e.stopPropagation()}
                                />
                            </div>
                        </div>
                    )}
                    <div className="px-3 py-1 text-[9px] font-black text-muted-foreground/50 uppercase tracking-[0.2em]">
                        {mailboxSearch ? `${filteredMailboxes.length} result${filteredMailboxes.length !== 1 ? "s" : ""}` : `${mailboxes.length} Connected`}
                    </div>
                    {visibleMailboxes.map((mailbox) => (
                        <SelectItem
                            key={mailbox.id}
                            value={mailbox.id}
                            className="font-bold text-[10px] uppercase tracking-widest py-3.5 px-3 cursor-pointer rounded-xl hover:bg-primary/5 transition-all focus:bg-primary/10"
                        >
                            <div className="flex items-center justify-between w-full gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={cn(
                                        "h-2 w-2 rounded-full shrink-0",
                                        mailbox.connected ? "bg-emerald-500" : "bg-muted"
                                    )} />
                                    <span className="truncate text-foreground/90 font-black">
                                        {mailbox.accountType || mailbox.email || (mailbox.provider === 'custom_email' ? 'Custom Email' : mailbox.provider)}
                                    </span>
                                </div>
                                {mailbox.id === currentMailboxId && (
                                    <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                                )}
                            </div>
                        </SelectItem>
                    ))}

                    {hiddenCount > 0 && (
                        <div className="px-3 py-2 text-[9px] font-bold text-muted-foreground/60 text-center">
                            +{hiddenCount} more — type to search
                        </div>
                    )}

                    <div className="h-px bg-border/20 my-2 mx-2" />

                    <SelectItem 
                        value="add_new" 
                        className="font-black text-[10px] uppercase tracking-widest py-3.5 px-3 cursor-pointer rounded-xl text-primary bg-primary/5 hover:bg-primary/10 focus:bg-primary/15 transition-all mb-1"
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-1 rounded-md bg-primary/10">
                                <PlusCircle className="h-3.5 w-3.5" />
                            </div>
                            <span>Add New Integration</span>
                        </div>
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
}
