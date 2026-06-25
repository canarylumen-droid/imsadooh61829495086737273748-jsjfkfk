'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

// 1. Gradient Text - Premium gradient animation on text
export function GradientText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.span
      className={`bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent bg-300% ${className}`}
      animate={{ backgroundPosition: ['0%', '100%', '0%'] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      style={{ backgroundSize: '200% 200%' }}
    >
      {children}
    </motion.span>
  );
}

// 2. Shiny Text - Subtle shimmer effect
export function ShinyText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.span
      className={className}
      animate={{
        backgroundPosition: ['200%', '-200%'],
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: 'linear',
      }}
      style={{
        backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 100%)',
        backgroundSize: '200% 100%',
      }}
    >
      {children}
    </motion.span>
  );
}

// 3. Blur Text - Smooth blur reveal
export function BlurText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: 'blur(12px)' }}
      whileInView={{ opacity: 1, filter: 'blur(0px)' }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// 4. Scroll Reveal - Content reveals as you scroll
export function ScrollReveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// 5. Glare Hover - Elegant hover effect on cards
export function GlareHover({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={`relative overflow-hidden ${className}`}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.3 }}
    >
      {children}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent"
        initial={{ x: '-100%', opacity: 0 }}
        whileHover={{ x: '100%', opacity: 0.2 }}
        transition={{ duration: 0.6 }}
        style={{ pointerEvents: 'none' }}
      />
    </motion.div>
  );
}

// 6. Electric Border - Animated border with glow
export function ElectricBorder({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={`relative ${className}`}
      whileHover={{
        boxShadow: '0 0 20px rgba(33, 150, 243, 0.6), 0 0 40px rgba(33, 150, 243, 0.3)',
      }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

// 7. Fade Content - Smooth fade transition
export function FadeContent({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// 8. Scroll Float - Floating effect on scroll
export function ScrollFloat({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ y: 0 }}
      whileInView={{ y: [-10, 10, -10] }}
      viewport={{ once: false }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
}

// 9. Count Up - Animated number counter
export function CountUp({ value, className = '' }: { value: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.span
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        {value}
      </motion.span>
    </motion.div>
  );
}

// 10. Staggered List - Items animate in sequence
export function StaggeredList({ items, className = '' }: { items: ReactNode[]; className?: string }) {
  const container = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.3,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, x: -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.4 },
    },
  };

  return (
    <motion.div className={className} variants={container} initial="hidden" whileInView="visible" viewport={{ once: true }}>
      {items.map((child, i) => (
        <motion.div key={i} variants={item}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
