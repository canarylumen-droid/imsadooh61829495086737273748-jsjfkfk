import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming you have a utils file, if not I'll define a simpler one

interface IntegrationStateButtonProps {
    onClick?: () => Promise<void>;
    label?: string;
    successLabel?: string;
    className?: string;
    onSuccess?: () => void;
}

export function IntegrationStateButton({
    onClick,
    label = 'Connect',
    successLabel = 'Connected',
    className,
    onSuccess
}: IntegrationStateButtonProps) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const timerRef = useRef<NodeJS.Timeout>();

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const handleClick = async () => {
        if (status === 'loading' || status === 'success') return;

        setStatus('loading');

        // Simulate API call delay if no promise provided, or await the real promise
        try {
            if (onClick) {
                await onClick();
            }

            setStatus('success');
            if (onSuccess) onSuccess();

            // Reset to idle after 3 seconds if needed, or keep as success
            // timerRef.current = setTimeout(() => setStatus('idle'), 3000);
        } catch (error) {
            console.error(error);
            setStatus('error');
            timerRef.current = setTimeout(() => setStatus('idle'), 3000);
        }
    };

    return (
        <div className="flex items-center gap-4">
            <div className="relative">
                <motion.button
                    onClick={handleClick}
                    disabled={status === 'loading'}
                    className={cn(
                        "relative flex items-center justify-center min-w-[140px] h-10 px-4 rounded-lg font-medium text-sm transition-all duration-300",
                        status === 'idle' && "bg-primary text-primary-foreground hover:bg-primary/90",
                        status === 'loading' && "bg-primary/80 cursor-wait",
                        status === 'success' && "bg-emerald-500 text-white hover:bg-emerald-600",
                        status === 'error' && "bg-destructive text-destructive-foreground",
                        className
                    )}
                    layout
                >
                    <AnimatePresence mode='wait'>
                        {status === 'idle' && (
                            <motion.span
                                key="idle"
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                            >
                                {label}
                            </motion.span>
                        )}
                        {status === 'loading' && (
                            <motion.span
                                key="loading"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                            >
                                <Loader2 className="w-5 h-5 animate-spin" />
                            </motion.span>
                        )}
                        {status === 'success' && (
                            <motion.span
                                key="success"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex items-center gap-2"
                            >
                                <Check className="w-4 h-4" />
                                {successLabel}
                            </motion.span>
                        )}
                        {status === 'error' && (
                            <motion.span
                                key="error"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex items-center gap-2"
                            >
                                <AlertCircle className="w-4 h-4" />
                                Error
                            </motion.span>
                        )}
                    </AnimatePresence>
                </motion.button>

                {/* Outline Ring Animation for Loading */}
                {status === 'loading' && (
                    <motion.div
                        className="absolute -inset-1 rounded-xl border-2 border-primary/30"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    />
                )}
            </div>
        </div>
    );
}
