import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { Sparkles as SparklesIcon, ChevronDown, Shield, FileText, LayoutGrid, Zap, Brain } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Magnetic } from "@/components/ui/Magnetic";

const SOLUTIONS = [
  {
    name: "For Agencies",
    displayName: <>For <span className="font-black text-primary ml-1">Agencies</span></>,
    desc: "Scale your client outreach without increasing headcount.",
    icon: LayoutGrid,
    badge: "Scale",
    href: "/solutions/agencies"
  },
  {
    name: "For Founders",
    displayName: <>For <span className="font-black text-primary ml-1">Founders</span></>,
    desc: "Clone yourself and close deals without being on calls.",
    icon: Zap,
    badge: "Velocity",
    href: "/solutions/sales-teams"
  },
  {
    name: "For Creators",
    displayName: <>For <span className="font-black text-primary ml-1">Creators</span></>,
    desc: "Monetize your audience with 24/7 AI engagement.",
    icon: Brain,
    badge: "New",
    href: "/solutions/creators"
  }
];

export function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "How it works", href: "/#how-it-works" },
    { name: "ROI Calculator", href: "/#calc" },
    { name: "Pricing", href: "/#pricing" },
  ];

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center p-3 pointer-events-none">
      <motion.nav
        className={`pointer-events-auto flex items-center justify-between px-4 md:px-6 py-2 transition-all duration-500 rounded-xl border ${scrolled
          ? "glass-premium w-[95%] max-w-7xl shadow-2xl border-primary/20"
          : "bg-transparent backdrop-blur-none w-full border-transparent"
          }`}
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center gap-4 lg:gap-12">
          <Magnetic>
            <Link href="/">
              <Logo className="h-8 w-8" textClassName="text-lg lg:text-xl font-black text-foreground" />
            </Link>
          </Magnetic>

          <div className="hidden lg:flex items-center gap-5 xl:gap-7">
            {/* Solutions Dropdown */}
            <div
              className="relative py-2 group"
              onMouseEnter={() => setHoveredMenu('solutions')}
              onMouseLeave={() => setHoveredMenu(null)}
            >
              <button className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-all outline-none">
                Solutions
                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${hoveredMenu === 'solutions' ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {hoveredMenu === 'solutions' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-full left-0 mt-2 glass-premium rounded-xl p-2 min-w-[320px] shadow-xl"
                  >
                    <div className="grid gap-2">
                      {SOLUTIONS.map((sol) => (
                        <Link key={sol.name} href={sol.href}>
                          <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 transition-all group/item border border-transparent hover:border-white/5">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary transition-colors">
                              <sol.icon className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black text-foreground uppercase tracking-tight">{sol.displayName || sol.name}</span>
                                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[8px] font-black uppercase tracking-wider">
                                  {sol.badge}
                                </span>
                              </div>
                              <span className="text-xs text-white/40 font-medium mt-1 whitespace-normal break-words leading-tight">{sol.desc}</span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                onClick={(e) => {
                  if (link.href?.includes("#")) {
                    const [path, hash] = link.href.split("#");
                    if (window.location.pathname === path || (path === "/" && window.location.pathname === "")) {
                      e.preventDefault();
                      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
                      setHoveredMenu(null);
                    }
                  }
                }}
                className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-all relative group"
              >
                {link.name}
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-primary transition-all group-hover:w-full" />
              </a>
            ))}

            {/* Resources Dropdown */}
            <div
              className="relative py-2 group"
              onMouseEnter={() => setHoveredMenu('resources')}
              onMouseLeave={() => setHoveredMenu(null)}
            >
              <button className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-all outline-none">
                Resources
                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${hoveredMenu === 'resources' ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {hoveredMenu === 'resources' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-full left-0 mt-2 glass-premium rounded-xl p-2 min-w-[220px] shadow-xl"
                  >
                    <div className="grid gap-2">
                      <Link href="/resources/niche-vault">
                        <div className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/5">
                          <LayoutGrid className="w-5 h-5 text-primary" />
                          <span className="text-xs font-black uppercase tracking-wider text-white/60">Niche Vault (20+)</span>
                        </div>
                      </Link>
                      <Link href="/resources/outreach-playbooks">
                        <div className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/5">
                          <Zap className="w-5 h-5 text-primary" />
                          <span className="text-xs font-black uppercase tracking-wider text-white/60">Outreach Playbooks</span>
                        </div>
                      </Link>
                      <Link href="/resources/api-docs">
                        <div className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/5">
                          <Brain className="w-5 h-5 text-primary" />
                          <span className="text-xs font-black uppercase tracking-wider text-white/60">Engineering Docs</span>
                        </div>
                      </Link>
                      <div
                        className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/5"
                        onClick={() => document.getElementById('privacy-modal')?.classList.remove('hidden')}
                      >
                        <Shield className="w-5 h-5 text-primary" />
                        <span className="text-xs font-black uppercase tracking-wider text-white/60">Privacy Policy</span>
                      </div>
                      <Link href="/terms-of-service">
                        <div className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/5">
                          <FileText className="w-5 h-5 text-primary" />
                          <span className="text-xs font-black uppercase tracking-wider text-white/60">Terms of Service</span>
                        </div>
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <Link href="/auth">
            <Button
              variant="ghost"
              className="hidden sm:flex text-[11px] font-bold uppercase tracking-widest px-4 h-9 rounded-full hover:bg-muted"
            >
              Log in
            </Button>
          </Link>
          <Magnetic>
            <Link href="/auth">
              <Button
                className="h-9 px-4 lg:px-6 rounded-full text-[10px] lg:text-[11px] font-bold uppercase tracking-widest shadow-md shadow-primary/20 hover:shadow-primary/40 transition-all bg-primary text-white hover:scale-[1.02]"
              >
                Get Started
              </Button>
            </Link>
          </Magnetic>

          {/* Mobile Menu Toggle */}
          <button
            className="lg:hidden w-10 h-10 rounded-xl bg-muted flex flex-col items-center justify-center gap-1 focus:outline-none"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <motion.span
              animate={mobileMenuOpen ? { rotate: 45, y: 5 } : { rotate: 0, y: 0 }}
              className="w-5 h-0.5 bg-foreground rounded-full"
            />
            <motion.span
              animate={mobileMenuOpen ? { opacity: 0 } : { opacity: 1 }}
              className="w-5 h-0.5 bg-foreground rounded-full"
            />
            <motion.span
              animate={mobileMenuOpen ? { rotate: -45, y: -5 } : { rotate: 0, y: 0 }}
              className="w-5 h-0.5 bg-foreground rounded-full"
            />
          </button>
        </div>
      </motion.nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[110] lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute right-0 top-0 bottom-0 w-[85%] sm:w-[320px] glass-premium border-l border-primary/20 p-6 flex flex-col shadow-2xl overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <span className="text-lg font-bold tracking-tight uppercase text-foreground">Audnix<span className="text-primary">.AI</span></span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setMobileMenuOpen(false)} 
                    className="rounded-xl hover:bg-primary/10 text-primary hover:text-primary-foreground"
                  >
                    <ChevronDown className="w-6 h-6 rotate-90" />
                  </Button>
              </div>

              <div className="flex flex-col gap-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/40 mb-2">Navigation</p>
                {navLinks.map((link) => (
                  <div
                    key={link.name}
                    className="relative group w-full"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setTimeout(() => {
                        if (link.href?.includes("#")) {
                          const [path, hash] = link.href.split("#");
                          if (window.location.pathname === path || path === "/" || window.location.pathname === "/") {
                            const el = document.getElementById(hash);
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth' });
                            }
                          } else {
                            window.location.href = link.href;
                          }
                        } else {
                          window.location.href = link.href;
                        }
                      }, 300);
                    }}
                  >
                    <div className="flex items-center justify-between py-3 border-b border-primary/5 group-active:bg-primary/5 px-2 rounded-xl transition-all cursor-pointer w-full h-full min-h-[50px]">
                      <span className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {link.name}
                      </span>
                      <ChevronDown className="w-5 h-5 -rotate-90 text-primary/40 group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/40 mb-2">Solutions</p>
                {SOLUTIONS.map((sol) => (
                  <div
                    key={sol.name}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 border border-transparent transition-all cursor-pointer"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setTimeout(() => {
                        window.location.href = sol.href;
                      }, 300);
                    }}
                  >
                    <sol.icon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground/80">{sol.name}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/40 mb-2">Resources</p>
                {[
                  { name: "Niche Vault", href: "/resources/niche-vault", icon: LayoutGrid },
                  { name: "Outreach Playbooks", href: "/resources/outreach-playbooks", icon: Zap },
                  { name: "Engineering Docs", href: "/resources/api-docs", icon: Brain },
                  { name: "Terms of Service", href: "/terms-of-service", icon: FileText },
                  { name: "Privacy Policy", href: "/privacy-policy", icon: Shield },
                ].map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 border border-transparent transition-all cursor-pointer"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setTimeout(() => {
                        window.location.href = item.href;
                      }, 300);
                    }}
                  >
                    <item.icon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground/80">{item.name}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex flex-col gap-4 pt-10">
                <Button
                  className="w-full h-12 rounded-xl text-xs font-bold uppercase tracking-widest bg-primary text-black cursor-pointer"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setTimeout(() => {
                      window.location.href = '/auth';
                    }, 300);
                  }}
                >
                  Get Started
                </Button>
                <p className="text-[9px] font-bold text-foreground/20 uppercase tracking-[0.4em] text-center">v4.0.0 Stable</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
