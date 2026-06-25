"use client";



const LINKS = {
  SOLUTIONS: [
    { name: "For Agencies",    href: "/solutions/agencies" },
    { name: "For Founders",    href: "/solutions/sales-teams" },
    { name: "For Creators",    href: "/solutions/creators" },
  ],
  PRODUCT: [
    { name: "Lead Recovery",   href: "/lead-recovery" },
    { name: "Objection Handler", href: "/objection-handling" },
    { name: "Pricing",         href: "/pricing" },
  ],
  COMPANY: [
    { name: "Our Process",     href: "#" },
    { name: "Engineering",     href: "#" },
    { name: "Contact",         href: "#" },
  ],
  LEGAL: [
    { name: "Privacy Policy",  href: "/privacy-policy" },
    { name: "Terms of Service", href: "/terms-of-service" },
    { name: "DPA Agreement",   href: "#" },
    { name: "Security",        href: "#" },
  ],
};

export function FooterSection() {
  return (
    <footer className="relative border-t border-[#1e1e1e]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Top row — brand + tagline */}
        <div className="border-b border-[#1e1e1e] py-12 grid lg:grid-cols-[1fr_2fr] gap-10">
          <div>
            {/* Logo */}
            <a href="/" className="inline-flex items-center gap-3 mb-5 group">
              <div className="w-8 h-8 border border-[#2196f3] flex items-center justify-center relative">
                <div className="w-2.5 h-2.5 bg-[#2196f3]" />
                <div className="absolute inset-0 bg-[#2196f3]/10 group-hover:bg-[#2196f3]/20 transition-colors" />
              </div>
              <span className="font-display text-2xl tracking-[0.12em] text-[#f2ede6]">AUDNIX.AI</span>
            </a>
            <p className="text-sm text-[#b0b0b0] leading-relaxed max-w-xs font-mono">
              Your autonomous AI sales rep. Close deals while you sleep.
            </p>
            <div className="flex gap-3 mt-6 flex-wrap">
              {[
                { name: "TWITTER",  href: "https://twitter.com/audnixai" },
                { name: "LINKEDIN", href: "https://linkedin.com/company/audnixai" },
                { name: "GITHUB",   href: "https://github.com/audnixai" },
                { name: "DISCORD",  href: "#" },
              ].map(s => (
                <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[10px] tracking-widest text-[#d0ccc3] hover:text-[#2196f3] hover:bg-[#2196f3]/10 transition-all px-3 py-2 border border-transparent hover:border-[#2196f3]/30">
                  {s.name} ↗
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {Object.entries(LINKS).map(([section, links]) => (
              <div key={section}>
                <h3 className="font-mono text-[9px] tracking-[0.2em] text-[#2196f3] mb-5">{section}</h3>
                <ul className="space-y-2">
                  {links.map(l => (
                    <li key={l.name}>
                      <a href={l.href} className="font-mono text-[12px] text-[#d0ccc3] hover:text-[#f2ede6] hover:bg-[#2196f3]/10 transition-all px-3 py-2 inline-flex items-center gap-2 font-medium">
                        {l.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar — copyright + legal links */}
        <div className="py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-mono text-[10px] text-[#9a9a9a] tracking-widest">
            © {new Date().getFullYear()} AUDNIX AI — ALL RIGHTS RESERVED
          </p>
          <div className="flex items-center gap-6">
            <a href="/terms-of-service" className="font-mono text-[10px] tracking-widest text-[#9a9a9a] hover:text-[#2196f3] transition-colors">
              TERMS OF SERVICE
            </a>
            <a href="/privacy-policy" className="font-mono text-[10px] tracking-widest text-[#9a9a9a] hover:text-[#2196f3] transition-colors">
              PRIVACY POLICY
            </a>
            <a href="/pricing" className="font-mono text-[10px] tracking-widest text-[#9a9a9a] hover:text-[#2196f3] transition-colors">
              PRICING
            </a>
          </div>
        </div>

      </div>
    </footer>
  );
}
