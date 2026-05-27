import { motion, AnimatePresence } from "framer-motion";
import { X, Smartphone, Maximize2, Minimize2, ZoomIn, ZoomOut, Mail, Apple, Smartphone as AndroidIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudnixLogo } from "@/components/ui/CustomIcons";
import DOMPurify from "dompurify";

interface EmailPreviewProps {
    subject: string;
    body: string;
    brandColor?: string;
    isOpen: boolean;
    onClose: () => void;
}

export function EmailPreview({ subject, body, brandColor, isOpen, onClose }: EmailPreviewProps) {
    const [zoom, setZoom] = useState(1);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [skin, setSkin] = useState<'ios' | 'android'>('ios');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            const timer = setTimeout(() => setIsLoading(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    const sanitizedBody = useMemo(() => DOMPurify.sanitize(body || ''), [body]);
    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.2, 2));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.2, 0.5));

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 md:p-10"
                >
                    {/* Close & Platform Controls */}
                    <div className="absolute top-8 right-8 flex items-center gap-4 z-[110]">
                        <Tabs value={skin} onValueChange={(v) => setSkin(v as any)} className="bg-white/5 p-1 rounded-xl border border-white/10">
                            <TabsList className="bg-transparent h-8 p-0 gap-1">
                                <TabsTrigger value="ios" className="data-[state=active]:bg-primary h-6 rounded-lg text-[10px] font-black uppercase px-4 flex items-center gap-2">
                                    <Apple className="h-3 w-3" /> iOS
                                </TabsTrigger>
                                <TabsTrigger value="android" className="data-[state=active]:bg-primary h-6 rounded-lg text-[10px] font-black uppercase px-4 flex items-center gap-2">
                                    <AndroidIcon className="h-3 w-3" /> Android
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 rounded-xl"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    <div className="relative w-full h-full flex flex-col items-center justify-center gap-6">
                        {/* Header / Zoom Controls */}
                        {!isLoading && (
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center gap-4 bg-white/5 border border-white/10 p-2 rounded-2xl backdrop-blur-xl mb-4"
                            >
                                <Button variant="ghost" size="icon" onClick={handleZoomOut} className="h-10 w-10 text-white/60 hover:text-white">
                                    <ZoomOut className="h-4 w-4" />
                                </Button>
                                <div className="text-[10px] font-black uppercase tracking-widest text-white/40 px-2">{Math.round(zoom * 100)}%</div>
                                <Button variant="ghost" size="icon" onClick={handleZoomIn} className="h-10 w-10 text-white/60 hover:text-white">
                                    <ZoomIn className="h-4 w-4" />
                                </Button>
                                <div className="w-px h-4 bg-white/10 mx-1" />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsFullScreen(!isFullScreen)}
                                    className="h-10 w-10 text-white/60 hover:text-white"
                                >
                                    {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                                </Button>
                            </motion.div>
                        )}

                        {/* Ultra-Premium Hardware Frame */}
                        <div className="relative">
                            {/* Realistic Hardware Side Buttons (L) */}
                            <div className="absolute -left-[14px] top-28 w-1 h-8 bg-[#1a1a1a] rounded-l-sm border-l border-white/10 shadow-[inset_1px_0_2px_rgba(255,255,255,0.1)]" /> {/* Silent Switch */}
                            <div className="absolute -left-[14px] top-44 w-1 h-16 bg-[#1a1a1a] rounded-l-sm border-l border-white/10 shadow-[inset_1px_0_2px_rgba(255,255,255,0.1)]" /> {/* Volume Up */}
                            <div className="absolute -left-[14px] top-64 w-1 h-16 bg-[#1a1a1a] rounded-l-sm border-l border-white/10 shadow-[inset_1px_0_2px_rgba(255,255,255,0.1)]" /> {/* Volume Down */}
                            {/* Physical Button (R) */}
                            <div className="absolute -right-[14px] top-52 w-1.5 h-24 bg-[#1a1a1a] rounded-r-sm border-r border-white/10 shadow-[inset_-1px_0_2px_rgba(255,255,255,0.1)]" /> {/* Power Button */}

                            <motion.div
                                layout
                                initial={{ scale: 0.9, y: 40, opacity: 0 }}
                                animate={{
                                    scale: zoom,
                                    y: 0,
                                    opacity: 1,
                                    width: isFullScreen ? "100%" : "min(380px, 90vw)",
                                    height: isFullScreen ? "100%" : "min(780px, 80vh)"
                                }}
                                className={cn(
                                    "bg-[#0a0a0a] border-[#1a1a1a] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8),0_0_120px_rgba(59,130,246,0.1)] relative overflow-hidden transition-all duration-700",
                                    skin === 'ios' ? "rounded-[3.8rem] border-[10px] md:border-[14px]" : "rounded-[2.8rem] border-[10px] md:border-[12px]",
                                    isFullScreen ? "max-w-5xl rounded-3xl" : "max-w-full"
                                )}
                            >
                                {/* Loading Overlay */}
                                <AnimatePresence>
                                    {isLoading && (
                                        <motion.div
                                            exit={{ opacity: 0, scale: 1.1 }}
                                            className="absolute inset-0 z-[60] bg-black flex items-center justify-center p-12 text-center"
                                        >
                                            <AudnixLogo />
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* Screen Glass Reflection & Shine */}
                                <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
                                    <div className="absolute -inset-x-full -top-full bottom-0 bg-gradient-to-tr from-transparent via-white/[0.03] to-white/[0.07] rotate-45 transform" />
                                </div>

                                {/* Device Notch / Punch */}
                                {skin === 'ios' ? (
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-[#1a1a1a] rounded-b-[2rem] z-[70] flex items-center justify-center pt-1 shadow-sm">
                                        <div className="w-12 h-1.5 rounded-full bg-white/5" />
                                    </div>
                                ) : (
                                    <div className="absolute top-5 left-1/2 -translate-x-1/2 w-4 h-4 bg-black rounded-full z-[70] shadow-[inset_0_2px_4px_rgba(255,255,255,0.1)] border border-white/5" />
                                )}

                                {/* Status Bar */}
                                <div className={cn(
                                    "h-14 flex items-center justify-between px-10 pt-6 bg-white shrink-0 relative z-40 transition-colors duration-500",
                                    skin === 'ios' ? "font-sans" : "font-roboto"
                                )}>
                                    <div className="text-[12px] font-black text-black">9:41</div>
                                    <div className="flex gap-2 items-center opacity-80">
                                        <div className="flex gap-0.5">
                                            {[1, 2, 3, 4].map(i => <div key={i} className="w-0.5 h-2.5 bg-black/80 rounded-full" />)}
                                        </div>
                                        <div className="w-5 h-2.5 rounded-sm border border-black/20 relative">
                                            <div className="absolute left-0 top-0 h-full w-4/5 bg-black" />
                                        </div>
                                    </div>
                                </div>

                                {/* Email Client App Shell - WITH SLIDE ANIMATION */}
                                <motion.div
                                    initial={{ y: "100%", opacity: 0 }}
                                    animate={{ y: isLoading ? "100%" : "0%", opacity: isLoading ? 0 : 1 }}
                                    transition={{
                                        duration: 0.8,
                                        ease: [0.19, 1, 0.22, 1], // Epic exponential ease-out
                                        opacity: { duration: 0.4 }
                                    }}
                                    className="flex flex-col h-full bg-white overflow-y-auto relative z-30"
                                >
                                    <div className={cn(
                                        "p-6 border-b border-zinc-100 bg-white/90 backdrop-blur-md sticky top-0 z-10",
                                        skin === 'ios' ? "pt-8" : "pt-8"
                                    )}>
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className={cn(
                                                "w-10 h-10 flex items-center justify-center text-white font-black text-xs",
                                                skin === 'ios' ? "rounded-full bg-zinc-900" : "rounded-xl bg-primary shadow-lg"
                                            )}>A</div>
                                            <div>
                                                <div className="text-[8px] font-black uppercase tracking-[0.3em] text-primary">Audnix Preview</div>
                                                <div className="text-sm font-bold text-zinc-900 leading-none mt-1">Professional Mode</div>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <h1 className="text-xl font-black text-zinc-900 leading-tight tracking-tight">{subject || "Strategic Proposal"}</h1>
                                            <div className="flex items-center gap-2">
                                                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Recipient:</div>
                                                <div className="text-[10px] font-bold text-zinc-600 px-2 py-0.5 bg-zinc-50 rounded-full border border-zinc-100">prospective_lead@target.io</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-8 text-black leading-relaxed whitespace-pre-wrap pb-32">
                                        <div
                                            dangerouslySetInnerHTML={{ __html: sanitizedBody }}
                                            className={cn(
                                                "prose prose-sm max-w-none prose-headings:font-black prose-p:font-medium prose-p:text-zinc-800 prose-p:leading-relaxed",
                                                skin === 'ios' ? "ui-ios" : "ui-android"
                                            )}
                                        />

                                        {/* Strategy Badge */}
                                        <div className="mt-16 p-6 rounded-[2.5rem] bg-gradient-to-br from-primary/[0.03] to-primary/[0.08] border border-primary/10 shadow-sm">
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-primary">Strategy: Direct Engagement</span>
                                            </div>
                                            <p className="text-[12px] text-zinc-700 leading-relaxed font-bold italic opacity-70">
                                                Objective: Increase engagement and response rates through personalized outreach.
                                            </p>
                                        </div>
                                    </div>

                                    {/* App Tab Bar Mockup */}
                                    <div className="mt-auto border-t border-zinc-100 bg-zinc-50/50 p-6 flex justify-around items-center shrink-0">
                                        {[1, 2, 3].map(i => <div key={i} className="w-10 h-1.5 bg-zinc-200 rounded-full opacity-50" />)}
                                    </div>
                                </motion.div>

                                {/* Home Indicator */}
                                <div className={cn(
                                    "absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1.5 rounded-full z-50",
                                    skin === 'ios' ? "bg-zinc-900/10" : "bg-black/5 w-12"
                                )} />
                            </motion.div>
                        </div>

                        <AnimatePresence>
                            {!isLoading && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-center space-y-2 mt-4"
                                >
                                    <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-primary shadow-xl shadow-primary/20">
                                        <Smartphone className="w-3.5 h-3.5 text-white" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Preview Active</span>
                                    </div>
                                    <p className="text-white/20 text-[9px] font-black uppercase tracking-[0.3em]">Audnix Preview Engine</p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
