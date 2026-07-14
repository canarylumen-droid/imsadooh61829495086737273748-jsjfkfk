
import { motion } from "framer-motion";

export function PremiumLoader({ text = "Loading..." }: { text?: string }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[300px] w-full p-8">
            <div className="relative w-16 h-16 mb-6">
                {/* Outer rotating ring */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 rounded-full border-b-2 border-primary/20"
                />
                {/* Inner spinner */}
                <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-2 rounded-full border-t-2 border-primary"
                />
                {/* Core pulse */}
                <motion.div
                    animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute inset-5 rounded-full bg-gradient-to-tr from-primary to-purple-500 blur-sm"
                />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center space-y-2"
            >
                <h3 className="text-lg font-medium bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent animate-pulse">
                    {text}
                </h3>
                <div className="flex gap-1 justify-center">
                    {[0, 1, 2].map((i) => (
                        <motion.div
                            key={i}
                            animate={{ y: [0, -5, 0] }}
                            transition={{ duration: 0.6, delay: i * 0.1, repeat: Infinity }}
                            className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30"
                        />
                    ))}
                </div>
            </motion.div>
        </div>
    );
}
