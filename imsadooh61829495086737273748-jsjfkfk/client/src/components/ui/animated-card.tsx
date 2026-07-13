import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Card } from "./card";

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  hover?: boolean;
  glowColor?: string;
}

export function AnimatedCard({
  children,
  className = "",
  delay = 0,
  hover = true,
  glowColor = "rgba(0, 217, 255, 0.2)"
}: AnimatedCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        duration: 0.6,
        delay,
        ease: [0.16, 1, 0.3, 1]
      }}
      whileHover={hover ? {
        y: -10,
        transition: { duration: 0.4, ease: "easeOut" }
      } : undefined}
      className="group relative"
    >
      {hover && (
        <div
          className="absolute -inset-2 bg-gradient-to-r from-primary/20 to-cyan-500/20 rounded-[inherit] opacity-0 group-hover:opacity-100 blur-[40px] transition-all duration-700 pointer-events-none"
          style={{ background: `radial-gradient(circle at center, ${glowColor}, transparent 70%)` }}
        />
      )}
      <Card className={`relative rounded-[inherit] ${className} transition-all duration-300 ${hover ? 'group-hover:border-primary/40 group-hover:shadow-2xl group-hover:shadow-primary/10' : ''}`}>
        {children}
      </Card>
    </motion.div>
  );
}

