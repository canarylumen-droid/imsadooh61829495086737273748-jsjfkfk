import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";

interface WelcomeCelebrationProps {
  username: string;
  onComplete?: () => void;
}

export function WelcomeCelebration({ username, onComplete }: WelcomeCelebrationProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  const capitalizedUsername = username
    ? username.charAt(0).toUpperCase() + username.slice(1).toLowerCase()
    : 'there';
  const fullText = `Hey ${capitalizedUsername}!`;

  const fireCelebration = useCallback(() => {
    const duration = 2500;
    const animationEnd = Date.now() + duration;

    const colors = ['#00d4ff', '#7c3aed', '#f59e0b', '#10b981', '#ec4899', '#ffffff'];

    const frame = () => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) return;

      const particleCount = 4;

      confetti({
        particleCount,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors,
        startVelocity: 45,
        gravity: 0.8,
        drift: 0,
        ticks: 300,
        shapes: ['square', 'circle'],
        scalar: 1.2
      });

      confetti({
        particleCount,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors,
        startVelocity: 45,
        gravity: 0.8,
        drift: 0,
        ticks: 300,
        shapes: ['square', 'circle'],
        scalar: 1.2
      });

      if (timeLeft > duration * 0.5) {
        confetti({
          particleCount: 2,
          angle: 90,
          spread: 120,
          origin: { x: 0.5, y: 0.3 },
          colors,
          startVelocity: 30,
          gravity: 1,
          ticks: 200,
          shapes: ['square', 'circle'],
          scalar: 1
        });
      }

      requestAnimationFrame(frame);
    };

    confetti({
      particleCount: 100,
      spread: 100,
      origin: { x: 0.5, y: 0.5 },
      colors,
      startVelocity: 35,
      gravity: 0.6,
      ticks: 400,
      shapes: ['square', 'circle'],
      scalar: 1.3
    });

    requestAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (displayedText.length < fullText.length) {
      const timer = setTimeout(() => {
        setDisplayedText(fullText.slice(0, displayedText.length + 1));
      }, 60);
      return () => clearTimeout(timer);
    } else {
      setIsTyping(false);
      fireCelebration();

      const completeTimer = setTimeout(() => {
        onComplete?.();
      }, 5000);

      return () => clearTimeout(completeTimer);
    }
  }, [displayedText, fullText, onComplete, fireCelebration]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
    >
      <motion.div
        className="fixed inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/30 pointer-events-none backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />

      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.35, type: "spring", stiffness: 250, damping: 20 }}
        className="text-center pointer-events-auto relative z-10 px-4"
      >
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <div className="inline-block p-4 rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 backdrop-blur-sm border border-white/10">
            <motion.span
              className="text-5xl"
              animate={{ rotate: [0, -10, 10, -10, 0] }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              🎉
            </motion.span>
          </div>
        </motion.div>

        <div className="text-5xl md:text-6xl font-bold text-white mb-4 min-h-16 flex items-center justify-center tracking-tight drop-shadow-lg">
          {displayedText}
          {isTyping && (
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
              className="ml-1 text-cyan-400"
            >
              |
            </motion.span>
          )}
        </div>

        {!isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="space-y-3"
          >
            <p className="text-xl text-white/90 font-semibold">
              Welcome to Audnix
            </p>
            <p className="text-base text-white/70">
              Your AI sales engine is ready to close deals
            </p>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              className="pt-4 flex items-center justify-center gap-3 text-sm text-white/50"
            >
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                AI Ready
              </span>
              <span className="text-white/30">•</span>
              <span>Complete setup to begin</span>
            </motion.div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
