import { motion } from "framer-motion";

export function CompetitorSection() {
    const COMPITITORS = [
        "MANYCHAT BOTS", "MAKE.COM AGENTS", "N8N SCRIPTS", "ZAPIER FLOWS",
        "INSTANTLY.AI", "SMARTLEAD.AI", "VA AGENCIES", "COLD EMAIL SPAM",
        "MANYCHAT BOTS", "MAKE.COM AGENTS"
    ];

    return (
        <section className="py-20 bg-background relative overflow-hidden border-y border-border/10">
            <div className="absolute inset-0 bg-red-500/5 blur-[100px] opacity-50" />

            <div className="max-w-7xl mx-auto relative z-10 px-4 mb-8 text-center">
                <span className="px-5 py-1.5 bg-background border border-destructive/30 rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-destructive mb-4 inline-block shadow-[0_0_20px_rgba(var(--destructive),0.2)]">
                    🚨 Legacy Tools Bleeding Revenue
                </span>
            </div>

            <div className="w-full overflow-hidden relative group">
                <div className="flex items-center gap-16 md:gap-24 animate-marquee whitespace-nowrap">
                    {COMPITITORS.map((brand, i) => (
                        <span
                            key={`${brand}-${i}`}
                            className="text-2xl md:text-3xl font-black tracking-[-0.02em] text-foreground/10 hover:text-foreground hover:drop-shadow-[0_0_8px_rgba(var(--destructive),0.8)] transition-all duration-300 cursor-none select-none uppercase"
                        >
                            {brand}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}
