import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { ShieldCheck, X } from "lucide-react";

// ============================================
// COOKIE UTILITY FUNCTIONS
// Uses actual HTTP cookies, not localStorage
// ============================================
const setCookie = (name: string, value: string, days: number) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
};

const getCookie = (name: string): string | null => {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
        let c = cookies[i].trim();
        if (c.indexOf(nameEQ) === 0) {
            return c.substring(nameEQ.length, c.length);
        }
    }
    return null;
};

export function CookieConsent() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Check for actual cookie (not localStorage)
        const consent = getCookie("audnix_consent");
        const declined = sessionStorage.getItem("audnix_cookie_declined");

        if (!consent && !declined) {
            const timer = setTimeout(() => setIsVisible(true), 2500);
            return () => clearTimeout(timer);
        }
    }, []);

    const accept = () => {
        // Set actual HTTP cookie that expires in 365 days
        setCookie("audnix_consent", "accepted", 365);

        // Also set localStorage for backward compatibility
        localStorage.setItem("audnix_cookie_consent", "true");

        // Enable analytics if gtag exists
        if (typeof window !== 'undefined' && (window as any).gtag) {
            (window as any).gtag('consent', 'update', {
                'analytics_storage': 'granted',
                'ad_storage': 'granted',
            });
        }

        setIsVisible(false);
    };

    const decline = () => {
        // Set session flag (disappears when browser closes)
        sessionStorage.setItem("audnix_cookie_declined", "true");

        // Set minimal consent cookie (required for GDPR compliance)
        setCookie("audnix_consent", "declined", 30);

        // Disable analytics
        if (typeof window !== 'undefined' && (window as any).gtag) {
            (window as any).gtag('consent', 'update', {
                'analytics_storage': 'denied',
                'ad_storage': 'denied',
            });
        }

        setIsVisible(false);
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 100, x: "-50%", opacity: 0 }}
                    animate={{ y: 0, x: "-50%", opacity: 1 }}
                    exit={{ y: 100, x: "-50%", opacity: 0 }}
                    transition={{ type: "spring", damping: 30, stiffness: 200 }}
                    className="fixed bottom-10 left-1/2 z-[99999] w-full max-w-2xl px-6 pointer-events-none"
                >
                    <div className="bg-black/95 p-6 md:p-8 rounded-[2rem] border border-white/10 shadow-2xl flex flex-col md:flex-row items-center gap-6 md:gap-10 relative overflow-hidden pointer-events-auto backdrop-blur-md">

                        <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-600/20 flex items-center justify-center">
                            <ShieldCheck className="w-8 h-8 text-blue-500" />
                        </div>

                        <div className="flex-1 text-center md:text-left space-y-1">
                            <h4 className="text-white font-bold tracking-widest text-[10px] uppercase">Privacy Policy</h4>
                            <p className="text-gray-200 text-xs font-medium leading-relaxed max-w-sm">
                                We utilize secure behavioral cookies to optimize your revenue projection models and maintain session integrity.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2 min-w-[160px] w-full md:w-auto">
                            <button
                                onClick={accept}
                                className="h-12 px-6 rounded-xl bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-all active:scale-95"
                            >
                                Accept
                            </button>
                            <button
                                onClick={decline}
                                className="h-10 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
                            >
                                Decline
                            </button>
                        </div>

                        <button
                            onClick={decline}
                            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/5 transition-colors"
                        >
                            <X className="w-4 h-4 text-gray-600" />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
