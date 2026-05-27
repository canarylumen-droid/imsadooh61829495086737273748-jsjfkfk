import { MobileShell } from "./MobileShell";
import { cn } from "@/lib/utils";
import { Instagram, Mail, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DOMPurify from "dompurify";
import { useMemo } from "react";

interface OutreachPreviewProps {
    type: 'email' | 'instagram';
    content: string;
    subject?: string;
    recipient?: string;
    isOpen: boolean;
    onClose: () => void;
}

export function OutreachPreview({ type, content, subject, recipient, isOpen, onClose }: OutreachPreviewProps) {
    const sanitizedContent = useMemo(() => DOMPurify.sanitize(content || ''), [content]);
    return (
        <MobileShell
            isOpen={isOpen}
            onClose={onClose}
            title={type === 'email' ? "Email Preview" : "Instagram DM"}
            subtitle={recipient || "Target Prospect"}
        >
            <Tabs defaultValue={type} className="w-full">
                <TabsContent value="email" className="m-0">
                    <div className="space-y-1.5 mb-6">
                        <h1 className="text-xl font-black text-zinc-900 leading-tight tracking-tight">{subject || "Strategic Proposal"}</h1>
                        <div className="flex items-center gap-2">
                            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">To:</div>
                            <div className="text-[10px] font-bold text-zinc-600 px-2 py-0.5 bg-zinc-50 rounded-full border border-zinc-100">
                                {recipient || "lead@target.io"}
                            </div>
                        </div>
                    </div>
                    <div className="text-black leading-relaxed whitespace-pre-wrap pb-32">
                        <div
                            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                            className="prose prose-sm max-w-none prose-headings:font-black prose-p:font-medium prose-p:text-zinc-800 prose-p:leading-relaxed"
                        />
                        <StrategyBadge strategy="Direct Professional Outreach" />
                    </div>
                </TabsContent>

                <TabsContent value="instagram" className="m-0">
                    <div className="flex flex-col gap-4 p-4 pb-32">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 p-[2px]">
                                <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
                                    <Instagram className="h-6 w-6 text-zinc-900" />
                                </div>
                            </div>
                            <div>
                                <div className="text-sm font-black text-zinc-900 leading-none">Audnix Agent</div>
                                <div className="text-[10px] text-zinc-400 mt-1">Active now</div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 max-w-[85%]">
                            <div className="bg-zinc-100 p-4 rounded-2xl rounded-tl-none text-sm text-zinc-800 leading-relaxed font-medium">
                                {content.replace(/<[^>]*>/g, '')}
                            </div>
                            <div className="text-[9px] text-zinc-400 font-bold ml-1 uppercase tracking-widest">Seen just now</div>
                        </div>

                        <StrategyBadge strategy="Social Engagement" />
                    </div>
                </TabsContent>
            </Tabs>
        </MobileShell>
    );
}

function StrategyBadge({ strategy }: { strategy: string }) {
    return (
        <div className="mt-12 p-6 rounded-[2.5rem] bg-gradient-to-br from-primary/[0.03] to-primary/[0.08] border border-primary/10 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">Strategy: {strategy}</span>
            </div>
            <p className="text-[12px] text-zinc-700 leading-relaxed font-bold italic opacity-70">
                AI-optimized for conversion based on performance data.
            </p>
        </div>
    );
}
