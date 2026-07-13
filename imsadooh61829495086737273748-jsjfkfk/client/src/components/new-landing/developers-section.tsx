import { useState, useEffect, useRef } from "react";
import { CheckCircle, Mail, Settings, BarChart3, Zap } from "lucide-react";

const WORKFLOW_STEPS = [
  {
    num: "01",
    title: "Connect Your Tools",
    desc: "Link Gmail, Outlook, Calendly, Google Calendar. One-click OAuth authentication.",
    icon: Mail,
    color: "#2196f3",
    preview: 0,
  },
  {
    num: "02",
    title: "Build Your Campaign",
    desc: "Write emails, set targets, define follow-up sequences. AI personalizes everything.",
    icon: Settings,
    color: "#2196f3",
    preview: 1,
  },
  {
    num: "03",
    title: "AI Sends at Scale",
    desc: "Personalized emails go out automatically. Smart timing. Intelligent follow-ups.",
    icon: Zap,
    color: "#2196f3",
    preview: 1,
  },
  {
    num: "04",
    title: "Track & Optimize",
    desc: "Real-time dashboards. See opens, clicks, replies. Optimize on the fly.",
    icon: BarChart3,
    color: "#2196f3",
    preview: 2,
  },
];

const STEP_PREVIEWS = [
  {
    title: "CONNECT YOUR TOOLS",
    content: `✓ Gmail Connected
✓ Outlook Connected
✓ Google Calendar Synced
✓ Calendly Integrated

Your Credentials:
└─ Email: protected@gmail.com
└─ Calendar: Read/Write Access
└─ Permissions: Send emails only

Status: Ready to launch campaigns`,
  },
  {
    title: "BUILD & SEND CAMPAIGN",
    content: `Subject: 👋 {name}, quick thought for {company}

Hi {first_name},

Saw that {company} recently {trigger_event}. We help teams like yours {value_prop}.

Quick question: Is {problem_area} something you're actively working on?

If yes, I have a 2-min video that might be helpful →

{cta_link}

{signature}`,
  },
  {
    title: "QUALIFIED LEADS",
    content: `Qualified Leads (23 This Week)

Sarah Mitchell
TechCorp · Product Manager
Status: Ready to Meet ✓
Next Step: Call Thu 2pm
Email: sarah@techcorp.com

David Chen
StartupX · CEO
Status: Interested
Next Step: Follow up Mon
Email: david@startupx.com

Maya Patel
InnovateCo · VP Sales
Status: Schedule Call
Next Step: Send calendar link
Email: maya@innovate.com`,
  },
];

const DASHBOARD_TABS = [
  {
    label: "EMAIL TEMPLATE",
    preview: `Subject: 👋 {name}, quick thought for {company}

Hi {first_name},

Saw that {company} recently {trigger_event}. We help teams like yours {value_prop}.

Quick question: Is {problem_area} something you're actively working on?

If yes, I have a 2-min video that might be helpful →

{cta_link}

{signature}`,
  },
  {
    label: "CAMPAIGN",
    preview: `Campaign: Tech Companies Q2 Outreach
Status: 🔴 Active

Recipients: 1,247 prospects
Sent: 892 emails (71%)
Opens: 373 (42% rate)
Replies: 165 (18.5% rate)
Meetings Booked: 23

Best Performer: Subject A
CTR: 12.3% · Response: 22%`,
  },
  {
    label: "LEADS",
    preview: `Qualified Leads (23 This Week)

Sarah Mitchell
TechCorp · Product Manager
Status: Ready to Meet ✓
Next Step: Call Thu 2pm

David Chen
StartupX · CEO
Status: Interested
Next Step: Follow up Mon

Maya Patel
InnovateCo · VP Sales
Status: Schedule Call
Next Step: Send calendar link`,
  },
];

const METRICS = [
  { label: "42% Open Rate", sub: "vs 25% average" },
  { label: "18.5% Response", sub: "Highly qualified" },
  { label: "10 Hours/Week", sub: "Time saved" },
  { label: "100x Outreach", sub: "Per campaign" },
];

export function DevelopersSection() {
  const [tab, setTab] = useState(0);
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="how-it-works" ref={ref} className="relative border-t border-[#1e1e1e] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Header row */}
        <div
          className={`border-b border-[#1e1e1e] py-8 transition-all duration-500 ${vis ? "opacity-100" : "opacity-0"}`}
        >
          <span className="sys-tag mb-3 block">WORKFLOW</span>
          <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
            HOW<br />
            <span style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>AUDNIX WORKS</span>
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 border-b border-[#1e1e1e]">
          {/* Left — Workflow Steps */}
          <div className="border-r border-[#1e1e1e]">
            <div className="border-b border-[#1e1e1e] p-6">
              <p className="text-sm text-[#d0cdc5] leading-relaxed max-w-md">
                4 simple steps to scale your cold email outreach. From setup to qualified leads in your inbox.
              </p>
            </div>

            {WORKFLOW_STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = tab === step.preview;
              return (
                <button
                  key={step.num}
                  onClick={() => setTab(step.preview)}
                  className={`w-full border-b border-[#1e1e1e] px-6 py-6 transition-all duration-400 cursor-pointer text-left ${
                    isActive ? "bg-[#0e0e0e] border-l-2 border-l-[#2196f3]" : "hover:bg-[#0a0a0a]"
                  } ${vis ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"}`}
                  style={{ transitionDelay: `${i * 60 + 100}ms` }}
                >
                  <div className="flex items-start gap-4">
                    <Icon className={`w-5 h-5 flex-shrink-0 mt-1 transition-colors ${
                      isActive ? "text-[#2196f3]" : "text-[#a0a0a0]"
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <span className={`font-display text-lg font-bold transition-colors ${
                          isActive ? "text-[#2196f3]" : "text-[#f2ede6]"
                        }`}>{step.title}</span>
                        <span className="font-mono text-[10px] text-[#7a7a7a]">{step.num}</span>
                      </div>
                      <p className="text-sm text-[#d0cdc5] leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                </button>
              );
            })}

            <div className="p-6 flex flex-col gap-3">
              <a href="/signup" className="font-mono text-[11px] text-[#2196f3] tracking-wider hover:underline">
                START FREE TRIAL →
              </a>
              <a href="mailto:hello@audnixai.com" className="font-mono text-[11px] text-[#d0cdc5] tracking-wider hover:text-[#f2ede6] transition-colors">
                BOOK A DEMO →
              </a>
            </div>
          </div>

          {/* Right — Dashboard Preview */}
          <div
            className={`flex flex-col transition-all duration-600 delay-200 ${
              vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            {/* Step Title */}
            <div className="border-b border-[#1e1e1e] bg-[#080808] px-6 py-4">
              <span className="font-mono text-[10px] text-[#2196f3] tracking-widest">
                {STEP_PREVIEWS[tab].title}
              </span>
            </div>

            {/* Preview Content */}
            <div className="flex-1 bg-[#050505] p-6 min-h-[300px] overflow-y-auto">
              <div className="space-y-4">
                {STEP_PREVIEWS[tab].content.split("\n").map((line, i) => (
                  <div
                    key={`${tab}-${i}`}
                    className="font-mono text-sm leading-relaxed"
                    style={{ 
                      animation: `fade-up 0.25s ease ${i * 30}ms both`,
                      color: line.includes("✓") || line.includes("Ready to Meet") || line.includes("Status: Ready") ? "#22c55e" : 
                             line.includes("👋") || line.includes("{") || line.includes("Subject:") ? "#2196f3" : 
                             line.includes("Status:") || line.includes("Next Step:") ? "#b0aca3" :
                             line.includes("Email:") || line.includes("@") ? "#5a5a5a" : "#5a5a5a"
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer with Metrics */}
            <div className="border-t border-[#1e1e1e] px-6 py-4 bg-[#080808] grid grid-cols-4 gap-4">
              {METRICS.map((m) => (
                <div key={m.label} className="text-center">
                  <div className="font-display text-sm text-[#2196f3] font-bold">{m.label}</div>
                  <div className="font-mono text-[9px] text-[#7a7a7a] mt-1">{m.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
