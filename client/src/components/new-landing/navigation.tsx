import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

const navLinks = [
  { name: "FEATURES",     href: "/#features" },
  { name: "HOW IT WORKS", href: "/#how-it-works" },
  { name: "COMPARISON",   href: "/#metrics" },
  { name: "PRICING",      href: "/pricing" },
];

export function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-[#050505]/95 backdrop-blur-sm border-b border-[#1e1e1e]" : "bg-transparent"
        }`}
      >
        {/* Main nav */}
        <div className="px-6 lg:px-12 h-14 flex items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-center gap-3 group">
            <img src="/logo.svg" alt="AUDNIX" className="h-7 w-auto" />
            <span className="font-display text-2xl tracking-[0.15em] text-[#f2ede6]">AUDNIX</span>

          </a>

          {/* Desktop links */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="font-mono text-[11px] tracking-[0.18em] text-[#b0aca3] hover:text-[#2196f3] transition-colors duration-200"
              >
                {link.name}
              </a>
            ))}
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="/login"
              className="font-mono text-[11px] tracking-widest text-[#b0aca3] hover:text-[#2196f3] transition-colors"
            >
              LOGIN
            </a>
            <a
              href="/signup"
              className="font-mono text-[11px] tracking-widest bg-[#2196f3] text-[#050505] px-5 h-9 flex items-center hover:bg-[#42a5f5] transition-colors font-semibold"
            >
              START FREE TRIAL →
            </a>
          </div>

          {/* Mobile burger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden text-[#f2ede6] p-1"
            aria-label="Toggle menu"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile menu */}
      <div
        className={`fixed inset-0 z-40 bg-[#050505] flex flex-col transition-opacity duration-300 overflow-y-auto ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        style={{ paddingTop: "88px" }}
      >
        <div className="border-t border-[#1e1e1e] flex flex-col flex-1">
          {navLinks.map((link, i) => (
            <a
              key={link.name}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`border-b border-[#1e1e1e] px-8 py-7 font-display text-5xl tracking-wider text-[#f2ede6] hover:text-[#2196f3] transition-all duration-300 flex items-center justify-between ${
                open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
              }`}
              style={{ transitionDelay: open ? `${i * 60}ms` : "0ms" }}
            >
              {link.name}
              <span className="font-mono text-xs text-[#3a3a3a]">
                {String(i + 1).padStart(2, "0")}
              </span>
            </a>
          ))}
        </div>
        <div className="mt-auto p-8 border-t border-[#1e1e1e] space-y-4">
          <a
            href="/login"
            onClick={() => setOpen(false)}
            className="w-full block text-center font-mono text-sm tracking-widest bg-[#0a0a0a] border border-[#1e1e1e] text-[#b0aca3] py-5 hover:border-[#2196f3] hover:text-[#2196f3] transition-colors"
          >
            LOGIN
          </a>
          <a
            href="/signup"
            onClick={() => setOpen(false)}
            className="w-full block text-center font-mono text-sm tracking-widest bg-[#2196f3] text-[#050505] py-5 font-semibold hover:bg-[#42a5f5] transition-colors"
          >
            START FREE TRIAL →
          </a>
        </div>
      </div>

    </>
  );
}
