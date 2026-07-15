const LINKS = {
  SOLUTIONS: [
    { name: "AI Sales Rep for Agencies", href: "/solutions/agencies" },
    { name: "Cold Email for Founders", href: "/solutions/sales-teams" },
    { name: "Lead Gen for Creators", href: "/solutions/creators" },
  ],
  PRODUCT: [
    { name: "Lead Recovery Engine", href: "/lead-recovery" },
    { name: "Objection Handling AI", href: "/objection-handling" },
    { name: "Pricing & Free Trial", href: "/pricing" },
  ],
  RESOURCES: [
    { name: "Niche Vault", href: "/resources/niche-vault" },
    { name: "Outreach Playbooks", href: "/resources/outreach-playbooks" },
    { name: "API Documentation", href: "/resources/api-docs" },
    { name: "Developer API", href: "/developer", badge: "NEW" },
  ],
  COMPANY: [
    { name: "Sign Up Free", href: "/signup" },
    { name: "Contact Sales", href: "mailto:hello@audnixai.com" },
    { name: "Privacy Policy", href: "/privacy-policy" },
    { name: "Terms of Service", href: "/terms-of-service" },
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
              <img src="/logo.svg" alt="AUDNIX" className="h-8 w-auto" />
              <span className="font-display text-2xl tracking-[0.12em] text-[#f2ede6]">AUDNIX.AI</span>
            </a>
            <p className="text-sm text-[#7a7a7a] leading-relaxed max-w-xs font-mono">
              Your autonomous AI sales rep. Close deals while you sleep.
            </p>
            <div className="flex gap-3 mt-6">
              {[
                { name: "TWITTER", href: "https://twitter.com/audnixai" },
                { name: "LINKEDIN", href: "https://linkedin.com/company/audnixai" },
                { name: "GITHUB", href: "https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk" },
                // TODO: Add Discord link when available
                { name: "DISCORD", href: "#" },
              ].map(s => (
                <a key={s.name} href={s.href} className="font-mono text-[10px] tracking-widest text-[#d0cdc5] hover:text-[#2196f3] hover:bg-[#2196f3]/10 transition-all px-3 py-2 rounded border border-transparent hover:border-[#2196f3]/30">
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
                  {links.map((l: { name: string; href: string; badge?: string }) => (
                    <li key={l.name}>
                      <a href={l.href} className="font-mono text-[12px] text-[#d0cdc5] hover:text-[#2196f3] hover:bg-[#2196f3]/10 transition-all px-3 py-2 rounded inline-flex items-center gap-2 font-medium">
                        {l.name}
                        {"badge" in l && l.badge && (
                          <span className="text-[9px] border border-[#2196f3]/30 text-[#2196f3] px-1.5 py-0.5 tracking-wider">
                            {l.badge}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>


      </div>
    </footer>
  );
}
