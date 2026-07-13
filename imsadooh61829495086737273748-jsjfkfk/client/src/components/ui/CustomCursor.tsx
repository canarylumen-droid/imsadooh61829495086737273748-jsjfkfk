import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

// ============================================
// ZERO-LAG CUSTOM CURSOR
// Uses direct DOM manipulation for instant response
// No React state = No re-renders = Zero lag
// ============================================

export const CustomCursor = () => {
    const [location] = useLocation();
    const isDashboardOrOnboarding = location.startsWith("/dashboard") || location.startsWith("/onboarding");

    const cursorRef = useRef<HTMLDivElement>(null);
    const rippleContainerRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef({ x: -100, y: -100 });
    const isClickedRef = useRef(false);
    const rafRef = useRef<number>(0);

    // Direct DOM update - bypasses React for instant response
    const updateCursorPosition = useCallback(() => {
        if (cursorRef.current) {
            const offset = isDashboardOrOnboarding ? 'translate(-10px, -4px)' : 'translate(-4px, -4px)';
            cursorRef.current.style.transform = `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0) ${offset}`;
        }
    }, [isDashboardOrOnboarding]);

    useEffect(() => {
        const style = document.createElement('style');
        style.id = 'audnix-cursor-styles';
        style.textContent = `
            * { cursor: none !important; }
            html, body, a, button, input, textarea, select, [role="button"], label, .cursor-pointer { 
                cursor: none !important; 
            }
            @media (pointer: fine) {
                body { cursor: none !important; }
            }
            .custom-cursor-main svg {
                width: 24px;
                height: 24px;
            }
        `;
        document.head.appendChild(style);

        const handleMouseMove = (e: MouseEvent) => {
            positionRef.current = { x: e.clientX, y: e.clientY };

            const target = e.target as HTMLElement;
            const isClickable = target.closest('button, a, [role="button"], select, .cursor-pointer');
            const isText = target.closest('p, span, h1, h2, h3, h4, h5, h6, input, textarea, code, pre');

            if (cursorRef.current) {
                if (isClickable) {
                    cursorRef.current.classList.add('is-grabbing');
                    cursorRef.current.classList.remove('is-text');
                    cursorRef.current.style.opacity = '1';
                } else if (isText) {
                    cursorRef.current.classList.add('is-text');
                    cursorRef.current.classList.remove('is-grabbing');
                    cursorRef.current.style.opacity = '1';
                } else {
                    cursorRef.current.classList.remove('is-grabbing');
                    cursorRef.current.classList.remove('is-text');
                    cursorRef.current.style.opacity = '1';
                }
            }

            // Use requestAnimationFrame for smooth 60fps updates
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(updateCursorPosition);

            // Show cursor
            if (cursorRef.current) {
                cursorRef.current.style.opacity = '1';
            }
        };

        const handleMouseDown = (e: MouseEvent) => {
            isClickedRef.current = true;
            // No scaling on click as requested
        };

        const handleMouseUp = () => {
            isClickedRef.current = false;
            updateCursorPosition();
        };

        const handleMouseLeave = () => {
            if (cursorRef.current) cursorRef.current.style.opacity = '0';
        };

        const handleMouseEnter = () => {
            if (cursorRef.current) cursorRef.current.style.opacity = '1';
        };

        window.addEventListener("mousemove", handleMouseMove, { passive: true });
        window.addEventListener("mousedown", handleMouseDown, { passive: true });
        window.addEventListener("mouseup", handleMouseUp, { passive: true });
        document.body.addEventListener("mouseleave", handleMouseLeave);
        document.body.addEventListener("mouseenter", handleMouseEnter);

        return () => {
            const styleEl = document.getElementById('audnix-cursor-styles');
            if (styleEl) styleEl.remove();
            if (rafRef.current) cancelAnimationFrame(rafRef.current);

            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mousedown", handleMouseDown);
            window.removeEventListener("mouseup", handleMouseUp);
            document.body.removeEventListener("mouseleave", handleMouseLeave);
            document.body.removeEventListener("mouseenter", handleMouseEnter);
        };
    }, [updateCursorPosition]);

    return (
        <>
            {/* Inline keyframes for ripple animation */}
            <style>{`
                @keyframes ripple-expand {
                    0% { transform: translate(-50%, -50%) scale(0); opacity: 0.8; }
                    100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
                }
            `}</style>

            {/* Ripple container */}
            <div
                ref={rippleContainerRef}
                className="fixed inset-0 pointer-events-none z-[999998] hidden lg:block overflow-hidden"
            />

            {/* Main cursor - uses will-change for GPU acceleration */}
            <div
                ref={cursorRef}
                className="fixed top-0 left-0 pointer-events-none z-[999999] hidden lg:block custom-cursor-main"
                style={{
                    opacity: 0,
                    willChange: 'transform',
                    transition: 'opacity 0.15s ease',
                }}
            >
                <style>{`
                    .custom-cursor-main.is-grabbing svg,
                    .custom-cursor-main.is-text svg {
                        display: none !important;
                    }
                    .custom-cursor-main.is-grabbing::after {
                        content: '';
                        display: block;
                        width: 32px;
                        height: 32px;
                        background: url('/cursor-hand.svg') no-repeat center;
                        background-size: contain;
                        transform: translate(-50%, -50%);
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                    }
                    .custom-cursor-main.is-text::after {
                        content: '';
                        display: block;
                        width: 2px;
                        height: 24px;
                        background: #06b6d4;
                        transform: translate(-50%, -50%);
                        box-shadow: 0 0 12px rgba(6, 182, 212, 0.6);
                        border-radius: 1px;
                    }
                `}</style>
                {/* Premium Unified MacBook-style Arrow */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-lg">
                    <path
                        d="M5.5 3L5.5 19L9.5 15L13 22L15 21L11.5 14L17.5 14L5.5 3Z"
                        fill="white"
                        stroke="black"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
        </>
    );
};
