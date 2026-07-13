import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

export function PrivacyModal() {
  const closeModal = () => {
    const modal = document.getElementById('privacy-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  };

  const sections = [
    {
      title: "1. Information We Collect",
      content: "We collect information you provide directly, including email, business details, and connection tokens. We also track interaction metrics to optimize your closer's performance."
    },
    {
      title: "2. Precision Usage",
      content: "Your data is used strictly to power your AI sales engine. We never sell your leads or conversation history to third parties."
    },
    {
      title: "3. Enterprise-Grade Security",
      content: "We implement industry-standard security measures including AES-256 encryption, secure OAuth sessions for Meta/Google, and automated rate limiting."
    },
    {
      title: "4. Your Control",
      content: "You maintain 100% ownership of your leads. Disconnect any integration or delete your entire data imprint with a single click in settings."
    }
  ];

  return (
    <div
      id="privacy-modal"
      className="hidden fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-[100] p-4"
      onClick={closeModal}
    >
      <motion.div
        className="glass-card rounded-[2.5rem] max-w-2xl w-full border-white/10 bg-[#0d1117] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
      >
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <div className="flex items-center gap-4">
            <Logo className="w-8 h-8" textClassName="text-lg font-black" />
            <div className="h-6 w-px bg-white/10" />
            <h2 className="text-lg font-bold tracking-tight text-white/80 uppercase">Privacy Policy</h2>
          </div>
          <button
            onClick={closeModal}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-white/40 hover:text-white transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {sections.map((sec, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="group"
            >
              <h3 className="text-xs font-black uppercase tracking-widest text-primary mb-3">{sec.title}</h3>
              <p className="text-white/50 font-medium leading-relaxed group-hover:text-white/80 transition-colors">
                {sec.content}
              </p>
            </motion.div>
          ))}

          <div className="pt-8 mt-8 border-t border-white/5">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/20">
              Last updated: January 2026 • support@audnixai.com
            </p>
          </div>
        </div>

        <div className="p-6 bg-white/[0.02] border-t border-white/5 flex justify-end">
          <button
            onClick={closeModal}
            className="px-8 py-3 bg-white text-black font-black rounded-full hover:scale-105 transition-transform active:scale-95 text-sm"
          >
            Acknowledge
          </button>
        </div>
      </motion.div>
    </div>
  );
}

