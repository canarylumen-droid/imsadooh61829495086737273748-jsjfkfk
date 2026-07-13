import React from "react";
import { DocumentationLayout, DocSection, DocGrid, HighlightCard } from "@/components/landing/DocumentationLayout";
import { Brain, Code, Terminal, Shield, Cpu, Zap, Database, Layers } from "lucide-react";

export default function ApiDocsPage() {
    return (
        <DocumentationLayout
            title="Engineering Workflow"
            subtitle="API & Integration Docs"
            sections={[
                {
                    id: "infrastructure",
                    title: "Architecture",
                    icon: Cpu,
                    content: (
                        <DocSection title="The Intelligence Core">
                            <p>Audnix is built on a high-availability, distributed agent architecture. Our proprietary logic engine processes complex sentiment and intent signals across multi-channel environments to ensure deterministic accuracy and zero-latency decision making.</p>
                            <DocGrid>
                                <HighlightCard
                                    icon={Brain}
                                    title="Deductive Logic Layer"
                                    desc="Our primary agent decision tree is deterministic, ensuring zero hallucinations."
                                />
                                <HighlightCard
                                    icon={Layers}
                                    title="Multi-Tenant Isolation"
                                    desc="Strict data-siloing architecture ensures your brand data never leaks between agents."
                                />
                            </DocGrid>
                        </DocSection>
                    )
                },
                {
                    id: "endpoints",
                    title: "API Reference",
                    icon: Terminal,
                    content: (
                        <DocSection title="Core Endpoints">
                            <div className="space-y-6">
                                <div className="p-6 rounded-2xl bg-black border border-white/10 font-mono text-xs">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500 font-bold uppercase">POST</span>
                                        <span className="text-white/60">/api/prospecting/v1/trigger</span>
                                    </div>
                                    <p className="text-white/30 mb-4">// Initializes an autonomous scan cycle for a specific niche.</p>
                                    <div className="text-primary">{`{ "niche": "roofing", "limit": 500, "priority": "high" }`}</div>
                                </div>

                                <div className="p-6 rounded-2xl bg-black border border-white/10 font-mono text-xs">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-500 font-bold uppercase">GET</span>
                                        <span className="text-white/60">/api/intelligence/leads/:id</span>
                                    </div>
                                    <p className="text-white/30 mb-4">// Retrieves the full intelligence profile of a verified lead.</p>
                                </div>
                            </div>
                        </DocSection>
                    )
                },
                {
                    id: "webhooks",
                    title: "Event Webhooks",
                    icon: Code,
                    content: (
                        <DocSection title="Real-time Synchronization">
                            <p className="mb-4">Sync Audnix events to your custom CRM or internal workflows using our high-retry webhook engine. Every request is signed with a SHA-256 HMAC signature for security.</p>
                            <ul className="list-disc pl-5 mt-4 space-y-4 text-white/60">
                                <li><code className="text-primary font-bold">lead.verified</code>: Triggered when a prospect clears the 12-point hygiene check.</li>
                                <li><code className="text-primary font-bold">reply.positive</code>: Sent when the AI detects a high-intent response.</li>
                                <li><code className="text-primary font-bold">meeting.booked</code>: Direct signal from our calendar orchestration layer.</li>
                            </ul>
                        </DocSection>
                    )
                },
                {
                    id: "security",
                    title: "Security & Rate Limits",
                    icon: Shield,
                    content: (
                        <DocSection title="System Governance">
                            <p className="mb-6">Audnix APIs are governed by strict token-bucket rate limits to ensure stability across the global proxy mesh.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Rate Limiting</h4>
                                    <p className="text-xs text-white/40 leading-relaxed font-medium">Standard tier is capped at 50,000 requests per 24 hours. Enterprise clusters feature uncapped burst capacity.</p>
                                </div>
                                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Authentication</h4>
                                    <p className="text-xs text-white/40 leading-relaxed font-medium">All requests must be authenticated via Bearer Token in the Authorization header.</p>
                                </div>
                            </div>
                        </DocSection>
                    )
                }
            ]}
        />
    );
}
