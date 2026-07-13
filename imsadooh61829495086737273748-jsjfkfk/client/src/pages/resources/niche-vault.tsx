import React, { useState } from "react";
import { DocumentationLayout, DocSection, DocGrid, HighlightCard } from "@/components/landing/DocumentationLayout";
import { LayoutGrid, Shield, Zap, Target, Rocket, Search, Users, Database, Globe, Briefcase, Plus, ChevronDown, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NicheVaultPage() {
    const [expanded, setExpanded] = useState(false);

    const initialNiches = [
        { name: "Roofing & Solar", focus: "Storm-damage triggers & permit data analytics." },
        { name: "Real Estate SaaS", focus: "CRM migration patterns & lead management gaps." },
        { name: "SaaS B2B", focus: "Enterprise churn & tech-stack replacement logic." },
        { name: "Venture Capital", focus: "LP discovery & portfolio synergy matching." },
        { name: "Fintech Ops", focus: "Compliance-first outreach & security-focused scripts." },
        { name: "EdTech Sales", focus: "Curriculum director outreach & school board mapping." },
        { name: "HealthTech", focus: "Clinic and hospital network integration signals." },
        { name: "Logistics", focus: "Supply chain bottleneck solving & freight broker logic." },
        { name: "Manufacturing", focus: "Industrial equipment sales & legacy infra upgrades." },
        { name: "Law Firms", focus: "Mass tort acquisition & plaintiff discovery engines." }
    ];

    const extraNiches = [
        { name: "E-commerce D2C", focus: "Ad-spend inefficiency & influencer saturation scans." },
        { name: "Creative Agencies", focus: "Ghosting client recovery & white-label scale logic." },
        { name: "Cybersecurity", focus: "Threat surface analysis & CISO-to-CISO dialogue." },
        { name: "Bio-Tech", focus: "R&D grant tracking & pharmaceutical partnership leads." },
        { name: "Luxury Real Estate", focus: "High-net-worth migration & offshore asset mapping." },
        { name: "Crypto / Web3", focus: "VC portfolio cross-over & decentralized dev intent." },
        { name: "Personal Brands", focus: "Audience monetization & ghostwriting partnership ops." },
        { name: "Staffing & Recruiting", focus: "VMS/MSP contract expiration & open-req detection." },
        { name: "Oil & Gas", focus: "Upstream equipment infra & regulatory compliance leads." },
        { name: "Hospitality / F&B", focus: "POS system replacement & delivery margin optimization." },
        { name: "HVAC & Plumbing", focus: "Commercial maintenance contract cycles & tech scans." },
        { name: "Fitness / Gym SaaS", focus: "Member churn reduction & personal trainer automation." },
        { name: "SaaS Dev Shops", focus: "Project backlog overflow & technical debt discovery." },
        { name: "DTC Supplements", focus: "Subscription retention & Amazon-to-Direct migration." },
        { name: "Event Planning", focus: "Corporate retreat cycles & venue capacity mapping." }
    ];

    return (
        <DocumentationLayout
            title="Niche Intelligence Vault"
            subtitle="25+ Pre-Trained Sectors"
            sections={[
                {
                    id: "overview",
                    title: "Sector Overview",
                    icon: LayoutGrid,
                    content: (
                        <DocSection title="Specialized Intelligence Clusters">
                            <p className="mb-8">
                                Audnix doesn't use generic AI. Our agents are organized into <strong>Niche Clusters</strong>. Each cluster is pre-loaded with industry terminology, objection patterns, and closing cycles specific to that market.
                            </p>
                            <DocGrid>
                                <HighlightCard
                                    icon={Briefcase}
                                    title="Professional Services"
                                    desc="Tailored for Legal, Accounting, and high-ticket Consulting sectors."
                                />
                                <HighlightCard
                                    icon={Globe}
                                    title="Digital Media"
                                    desc="Specialized in Creative Agencies and Personal Brand scaling logic."
                                />
                                <HighlightCard
                                    icon={Shield}
                                    title="Regulated Markets"
                                    desc="Pre-configured for compliance-heavy sectors like Fintech and HealthTech."
                                />
                                <HighlightCard
                                    icon={Search}
                                    title="Technical Sales"
                                    desc="Trained on complex technical debt and legacy infrastructure upgrade signals."
                                />
                            </DocGrid>
                        </DocSection>
                    )
                },
                {
                    id: "training",
                    title: "The Training Workflow",
                    icon: Brain,
                    content: (
                        <DocSection title="Intelligent Specialization">
                            <p className="mb-8">
                                How do Audnix agents become experts? Every cluster undergoes a rigorous <strong>Knowledge Ingestion Cycle</strong> before it is deployed to the global network. We don't just feed the AI data; we architect understanding.
                            </p>
                            <div className="space-y-6">
                                <div className="p-8 rounded-[2rem] bg-white/[0.02] border border-white/5 space-y-4">
                                    <h4 className="text-xl font-black uppercase tracking-tight text-white mb-2">Stage 1: Knowledge Ingestion</h4>
                                    <p className="text-sm text-white/40 leading-relaxed font-medium">We ingest 10,000+ real-world case studies, whitepapers, and customer support transcripts for each niche to map the exact vocabulary and pain points used by decision makers.</p>
                                </div>
                                <div className="p-8 rounded-[2rem] bg-white/[0.02] border border-white/5 space-y-4">
                                    <h4 className="text-xl font-black uppercase tracking-tight text-white mb-2">Stage 2: Sentiment Mapping</h4>
                                    <p className="text-sm text-white/40 leading-relaxed font-medium">Our models identify 'Sentiment Triggers'—specific phrasing that indicates a prospect is frustrated, skeptical, or ready to buy. This ensures our agents never sound like generic bots.</p>
                                </div>
                            </div>
                        </DocSection>
                    )
                },
                {
                    id: "industries",
                    title: "The Market Matrix",
                    icon: Database,
                    content: (
                        <DocSection title="Pre-Analyzed Markets">
                            <p className="mb-8 font-medium">
                                Scroll through our specialized sectors. Each one has been engineered with over 100,000+ training cycles specific to local market pain points.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {initialNiches.map((n, i) => (
                                    <div key={i} className="p-5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-primary/20 transition-all group">
                                        <h4 className="text-sm font-bold text-primary mb-1 uppercase tracking-tight group-hover:text-white transition-colors">{n.name}</h4>
                                        <p className="text-[10px] text-white/40 font-medium leading-relaxed">{n.focus}</p>
                                    </div>
                                ))}
                                {expanded && extraNiches.map((n, i) => (
                                    <div key={i} className="p-5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-primary/20 transition-all group">
                                        <h4 className="text-sm font-bold text-primary mb-1 uppercase tracking-tight group-hover:text-white transition-colors">{n.name}</h4>
                                        <p className="text-[10px] text-white/40 font-medium leading-relaxed">{n.focus}</p>
                                    </div>
                                ))}
                            </div>
                            {!expanded && (
                                <div className="mt-8 flex justify-center">
                                    <Button
                                        onClick={() => setExpanded(true)}
                                        className="h-12 px-8 rounded-full bg-white/5 border border-white/10 text-white font-black uppercase text-[10px] tracking-widest hover:bg-white/10 hover:border-primary/40 transition-all flex items-center gap-2"
                                    >
                                        <Plus className="w-3.5 h-3.5 text-primary" />
                                        Initialize 15+ Advanced Clusters
                                    </Button>
                                </div>
                            )}
                        </DocSection>
                    )
                },
                {
                    id: "case-studies",
                    title: "Performance Metrics",
                    icon: Zap,
                    content: (
                        <DocSection title="Deterministic Results">
                            <p className="mb-8">Every niche follows a success path engineered over 1M+ real-world conversations and outcomes.</p>
                            <DocGrid>
                                <div className="p-10 rounded-[2.5rem] bg-black/40 border border-white/5 space-y-4 hover:border-primary/20 transition-colors">
                                    <div className="text-5xl font-black text-white tracking-tighter">4.2x</div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Conversion Velocity</div>
                                    <p className="text-xs text-white/40 leading-relaxed font-medium">Average increase in meeting volume verified across B2B Agency campaigns.</p>
                                </div>
                                <div className="p-10 rounded-[2.5rem] bg-black/40 border border-white/5 space-y-4 hover:border-primary/20 transition-colors">
                                    <div className="text-5xl font-black text-white tracking-tighter">$12k</div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Labor Recovery</div>
                                    <p className="text-xs text-white/40 leading-relaxed font-medium">Net profit increase per month by replacing manual SDR headcount.</p>
                                </div>
                            </DocGrid>
                        </DocSection>
                    )
                }
            ]}
        />
    );
}
