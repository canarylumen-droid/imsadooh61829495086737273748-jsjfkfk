import React, { useState, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navigation } from "@/components/landing/Navigation";
import { ChevronRight, FileText, LayoutGrid, Zap, Brain, Shield, Rocket, Search, Users, Database } from "lucide-react";
import { Link } from "wouter";

interface Section {
    id: string;
    title: string;
    icon: any;
    content: ReactNode;
}

interface DocumentationLayoutProps {
    title: string;
    subtitle: string;
    sections: Section[];
}

export function DocumentationLayout({ title, subtitle, sections }: DocumentationLayoutProps) {
    const [activeSection, setActiveSection] = useState(sections[0]?.id || "");

    return (
        <div className="min-h-screen bg-[#030303] text-white selection:bg-primary selection:text-black">
            <Navigation />

            <main className="pt-32 pb-20 px-4 md:px-8 max-w-7xl mx-auto">
                {/* Header */}
                <header className="mb-16 space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-widest">
                        <Rocket className="w-3 h-3" />
                        {subtitle}
                    </div>
                    <h1 className="text-3xl md:text-5xl lg:text-6xl font-black tracking-tighter uppercase">
                        {title.split(' ').map((word, i) => (
                            <span key={i} className={i === title.split(' ').length - 1 ? "text-primary" : ""}>{word} </span>
                        ))}
                    </h1>
                </header>

                <div className="flex flex-col lg:flex-row gap-12 items-start">
                    {/* Sidebar Tabs */}
                    <aside className="w-full lg:w-72 lg:sticky lg:top-32 space-y-2 lg:border-r lg:border-white/5 lg:pr-8">
                        <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] mb-4 pl-4">Navigation</div>
                        {sections.map((section) => (
                            <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all group ${activeSection === section.id
                                    ? "bg-primary text-black shadow-[0_10px_20px_rgba(0,210,255,0.2)]"
                                    : "text-white/40 hover:text-white hover:bg-white/5"
                                    }`}
                            >
                                <section.icon className={`w-4 h-4 ${activeSection === section.id ? "text-black" : "text-primary/60 group-hover:text-primary"}`} />
                                <span className="flex-1 text-left uppercase tracking-tight">{section.title}</span>
                                <ChevronRight className={`w-4 h-4 transition-transform ${activeSection === section.id ? "rotate-90 opacity-40" : "opacity-0"}`} />
                            </button>
                        ))}
                    </aside>

                    {/* Content Area */}
                    <section className="flex-1 w-full min-h-[60vh]">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeSection}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="space-y-8"
                            >
                                {sections.find(s => s.id === activeSection)?.content}
                            </motion.div>
                        </AnimatePresence>
                    </section>
                </div>
            </main>

            {/* Footer-Documentation - Shared across pages as requested */}
            <footer className="py-20 border-t border-white/5 bg-black">
                <div className="max-w-7xl mx-auto px-8 space-y-16">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
                        <div className="space-y-6">
                            <h3 className="text-xl font-black uppercase tracking-tighter">Niche <span className="text-primary">Intelligence</span></h3>
                            <p className="text-white/40 text-xs leading-relaxed font-medium">
                                Audnix agents are pre-trained on 20+ specific high-growth sectors. We don't just find leads; we architect conversations.
                            </p>
                        </div>

                        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-8 gap-x-4">
                            {[
                                "Roofing & Solar", "Real Estate SaaS", "Creative Agencies", "E-com D2C", "SaaS B2B",
                                "Venture Capital", "Fintech Ops", "EdTech Sales", "HealthTech", "Logistics",
                                "Crypto/Web3", "Manufacturing", "Legal Firms", "Consulting", "Personal Brands",
                                "Bio-Tech", "Luxury Real Estate", "Event Planning", "Recruitment", "Cybersecurity"
                            ].map((niche, i) => (
                                <div key={i} className="space-y-2 group cursor-default">
                                    <div className="h-0.5 w-4 bg-primary/20 group-hover:w-full transition-all duration-500" />
                                    <span className="text-[10px] font-bold text-white/40 group-hover:text-primary transition-colors uppercase tracking-widest">{niche}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] font-black uppercase tracking-[0.4em] text-white/10">
                        <div>© 2026 AUDNIX GLOBAL PROSPECTING NETWORK</div>
                        <div className="flex gap-8">
                            <Link href="/privacy-policy" className="hover:text-white transition-colors">Privacy</Link>
                            <Link href="/terms-of-service" className="hover:text-white transition-colors">Terms</Link>
                            <Link href="/data-deletion" className="hover:text-white transition-colors">Data</Link>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}

// Helper components for rich documentation
export const DocSection = ({ title, children }: { title: string, children: ReactNode }) => (
    <div className="space-y-6 bg-white/[0.02] border border-white/5 p-8 rounded-[2rem]">
        <h2 className="text-2xl font-black uppercase tracking-tight text-white border-b border-primary/20 pb-4">{title}</h2>
        <div className="prose prose-invert max-w-none text-white/60 font-medium leading-relaxed">
            {children}
        </div>
    </div>
);

export const DocGrid = ({ children }: { children: ReactNode }) => (
    <div className="grid md:grid-cols-2 gap-6">
        {children}
    </div>
);

export const HighlightCard = ({ title, desc, icon: Icon }: { title: string, desc: string, icon: any }) => (
    <div className="p-6 rounded-2xl bg-[#0d1117] border border-white/5 hover:border-primary/20 transition-all group">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform">
            <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-bold text-white uppercase mb-2">{title}</h3>
        <p className="text-xs text-white/40 leading-relaxed font-medium">{desc}</p>
    </div>
);
