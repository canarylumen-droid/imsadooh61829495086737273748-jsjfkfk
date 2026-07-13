import React from "react";
import { DocumentationLayout, DocSection, DocGrid, HighlightCard } from "@/components/landing/DocumentationLayout";
import { Zap, Target, Book, MessageSquare, Shield, Rocket, Brain, Layers, ArrowRight } from "lucide-react";

export default function PlaybooksPage() {
    return (
        <DocumentationLayout
            title="Outreach Playbooks"
            subtitle="The Winning Sequences"
            sections={[
                {
                    id: "framework",
                    title: "The Logic Framework",
                    icon: Layers,
                    content: (
                        <DocSection title="The 3-Stage Closing Cycle">
                            <p>Audnix doesn't just 'spray and pray'. Every playbook is built on three core pillars of intelligent persuasion.</p>
                            <DocGrid>
                                <HighlightCard
                                    icon={Target}
                                    title="Pillar 1: Pattern Interrupt"
                                    desc="Breaking the prospect's defensive wall with highly specific, non-templated openers."
                                />
                                <HighlightCard
                                    icon={Brain}
                                    title="Pillar 2: Authority Anchor"
                                    desc="Layering in proof and case-studies derived directly from your Brand PDF."
                                />
                                <HighlightCard
                                    icon={Zap}
                                    title="Pillar 3: The Low-Friction Close"
                                    desc="Converting interest into a calendar event with zero manual negotiation."
                                />
                            </DocGrid>
                        </DocSection>
                    )
                },
                {
                    id: "scripts",
                    title: "Sequence Library",
                    icon: Book,
                    content: (
                        <DocSection title="Pre-Built Blueprints">
                            <p className="mb-8">Our sequence library is updated weekly based on collective mesh intelligence. These blueprints are proven to break through the initial barrier of professional skepticism.</p>
                            <div className="space-y-6">
                                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 group cursor-default">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-black uppercase text-primary tracking-widest">The 'Founder to Founder' Pulse</h4>
                                        <span className="text-[10px] font-bold text-emerald-500 uppercase">High Conversion</span>
                                    </div>
                                    <p className="text-xs text-white/40 leading-relaxed font-medium">
                                        "Hey [Name], I noticed you're scaling your [X] department. We just released a workflow that handled [Y] for [Similar Company] without increasing their headcount. Curious if you're open to an advice-swap on how you're handling [Z]?"
                                    </p>
                                </div>

                                <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 group cursor-default">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-black uppercase text-primary tracking-widest">The 'Infrastructure Review' Lead</h4>
                                        <span className="text-[10px] font-bold text-blue-500 uppercase">Educational</span>
                                    </div>
                                    <p className="text-xs text-white/40 leading-relaxed font-medium">
                                        "We ran a brief scan of [Company]'s digital outreach. Found 3 critical leaks where your leads are dropping off. I've mapped the fix in a 2-page doc for you. Where should I send it?"
                                    </p>
                                </div>
                            </div>
                        </DocSection>
                    )
                },
                {
                    id: "logic",
                    title: "Response Logic",
                    icon: Brain,
                    content: (
                        <DocSection title="Adaptive Branching">
                            <p className="mb-8">
                                Linear sequences are dead. Audnix agents use <strong>Sentiment-Based Branching</strong> to adapt the conversation in real-time. Depending on the prospect's reply, the AI can pivot between four distinct logic states.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-6 rounded-2xl bg-[#0d1117] border border-white/5 space-y-3">
                                    <div className="flex items-center gap-2 text-primary font-black uppercase text-[10px]">
                                        <Zap className="w-3 h-3" /> State A: Aggressive Value
                                    </div>
                                    <p className="text-[11px] text-white/40 font-medium">For high-intent leads who need immediate technical validation.</p>
                                </div>
                                <div className="p-6 rounded-2xl bg-[#0d1117] border border-white/5 space-y-3">
                                    <div className="flex items-center gap-2 text-purple-500 font-black uppercase text-[10px]">
                                        <Shield className="w-3 h-3" /> State B: Educational Defensive
                                    </div>
                                    <p className="text-[11px] text-white/40 font-medium">For skeptical leads requiring social proof and deep-dive reviews.</p>
                                </div>
                            </div>
                        </DocSection>
                    )
                },
                {
                    id: "automation",
                    title: "Automation Spacing",
                    icon: Rocket,
                    content: (
                        <DocSection title="The Psychology of Timing">
                            <p>Sequence timing is everything. Audnix agents space outreach according to prospect sentiment.</p>
                            <div className="mt-8 space-y-4">
                                <div className="flex items-center gap-4 text-xs font-bold text-white/60">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">1</div>
                                    <span>Immediate Intelligent Opener (Social/Email)</span>
                                </div>
                                <div className="w-px h-6 bg-white/10 ml-4" />
                                <div className="flex items-center gap-4 text-xs font-bold text-white/60">
                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40">2</div>
                                    <span>Day 2: Contextual Bump (Logic Layer)</span>
                                </div>
                                <div className="w-px h-6 bg-white/10 ml-4" />
                                <div className="flex items-center gap-4 text-xs font-bold text-white/60">
                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40">3</div>
                                    <span>Day 5: Proof-Injection (Case Study)</span>
                                </div>
                            </div>
                        </DocSection>
                    )
                }
            ]}
        />
    );
}
