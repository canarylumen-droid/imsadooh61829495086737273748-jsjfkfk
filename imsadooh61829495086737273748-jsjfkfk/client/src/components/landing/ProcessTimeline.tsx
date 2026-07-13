import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function ProcessTimeline() {
  const steps = [
    { num: 1, text: "Connect email & upload leads" },
    { num: 2, text: "Upload voice sample (optional)" },
    { num: 3, text: "Set your brand PDF" },
    { num: 4, text: "Done — AI takes over" }
  ];

  return (
    <section className="py-20 px-4">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold mb-16 text-center text-foreground">
          Simple Setup
        </h2>

        {/* Timeline Container */}
        <div className="relative">
          {/* Desktop Timeline (visible only on md and up) */}
          <div className="hidden md:block">
            <div className="flex items-center justify-center gap-2 mb-16">
              {steps.map((step, idx) => (
                <div key={step.num} className="flex items-center flex-1">
                  {/* Step Circle */}
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.1 }}
                    className="relative z-10 flex-shrink-0"
                  >
                    {/* Glow effect */}
                    <motion.div
                      className="absolute inset-0 rounded-full bg-primary/30 blur-lg"
                      animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.5, 0.8, 0.5]
                      }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        delay: idx * 0.3
                      }}
                    />

                    {/* Main circle */}
                    <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border-2 border-primary flex items-center justify-center">
                      <span className="text-2xl font-bold text-primary relative z-10">
                        {step.num}
                      </span>

                      {/* Inner animated ring */}
                      <motion.div
                        className="absolute inset-1 rounded-full border-2 border-transparent border-t-primary border-r-primary"
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 3,
                          repeat: Infinity,
                          ease: "linear",
                          delay: idx * 0.2
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* Arrow Connector (between steps) */}
                  {idx < steps.length - 1 && (
                    <motion.div
                      className="flex-1 h-1 mx-2 relative"
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.1 + 0.2 }}
                    >
                      {/* Background line */}
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/30 to-primary/10 rounded-full" />

                      {/* Animated arrow dots moving along the line */}
                      <div className="absolute inset-0 overflow-hidden rounded-full">
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-primary to-transparent"
                          animate={{
                            x: ["-100%", "100%"]
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            ease: "linear",
                            delay: idx * 0.3
                          }}
                        />
                      </div>

                      {/* Arrow icon in center */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <motion.div
                          animate={{
                            x: [0, 6, 0]
                          }}
                          transition={{
                            duration: 1.2,
                            repeat: Infinity,
                            ease: "easeInOut"
                          }}
                        >
                          <ArrowRight className="w-4 h-4 text-primary" />
                        </motion.div>
                      </div>
                    </motion.div>
                  )}
                </div>
              ))}
            </div>

            {/* Step descriptions below timeline */}
            <div className="grid grid-cols-4 gap-4 mt-8">
              {steps.map((step) => (
                <motion.div
                  key={step.num}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="text-center"
                >
                  <p className="text-foreground/90 font-medium text-sm">{step.text}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Mobile Timeline (visible only on mobile) */}
          <div className="md:hidden space-y-6">
            {steps.map((step, idx) => (
              <div key={step.num}>
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className="flex items-start gap-4"
                >
                  {/* Circle */}
                  <div className="relative flex-shrink-0 mt-1">
                    <motion.div
                      className="absolute inset-0 rounded-full bg-primary/30 blur-lg"
                      animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.5, 0.8, 0.5]
                      }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        delay: idx * 0.3
                      }}
                    />
                    <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border-2 border-primary flex items-center justify-center">
                      <span className="text-lg font-bold text-primary">{step.num}</span>
                      <motion.div
                        className="absolute inset-1 rounded-full border-2 border-transparent border-t-primary border-r-primary"
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 3,
                          repeat: Infinity,
                          ease: "linear",
                          delay: idx * 0.2
                        }}
                      />
                    </div>
                  </div>

                  {/* Step text and connector */}
                  <div className="flex-1 pt-1">
                    <p className="text-foreground/90 font-medium text-sm mb-4">{step.text}</p>

                    {/* Vertical arrow for mobile */}
                    {idx < steps.length - 1 && (
                      <motion.div
                        className="flex justify-start ml-7 mb-4"
                        animate={{
                          y: [0, 8, 0]
                        }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          ease: "easeInOut"
                        }}
                      >
                        <div className="w-0.5 h-8 bg-gradient-to-b from-primary to-primary/30 rounded-full" />
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              </div>
            ))}
          </div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="text-2xl font-bold text-center text-primary mt-16"
        >
          Your job: show up and close.
        </motion.p>
      </div>
    </section>
  );
}
