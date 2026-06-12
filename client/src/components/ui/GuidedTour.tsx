import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { 
  X, 
  ChevronRight, 
  Sparkles, 
  Navigation, 
  Upload, 
  MessageSquare, 
  Shield, 
  BarChart3, 
  Check 
} from "lucide-react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  path?: string;
  icon?: React.ReactNode;
  position?: "left" | "right" | "top" | "bottom" | "center";
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Audnix",
    description: "Your all-in-one AI revenue recovery suite. Let's take a quick tour of the key features to get you started.",
    icon: <Sparkles className="w-5 h-5 text-primary" />,
    position: "center",
  },
  {
    id: "sidebar",
    title: "Main Navigation",
    description: "Access all your tools, settings, and reports from here. Collapse it for more space.",
    targetSelector: "[data-testid='sidebar-desktop']",
    icon: <Navigation className="w-5 h-5 text-primary" />,
    position: "right",
  },
  {
    id: "import-leads",
    title: "Import Leads",
    description: "Upload your CSV or PDF files here to start the recovery process. The AI will automatically score and prioritize them.",
    targetSelector: "[data-testid='nav-item-import leads']",
    path: "/dashboard/lead-import",
    icon: <Upload className="w-5 h-5 text-primary" />,
    position: "right",
  },
  {
    id: "inbox",
    title: "Inbox",
    description: "View and manage all AI-driven conversations. Monitor objection handling and deal closures in real-time.",
    targetSelector: "[data-testid='nav-item-inbox']",
    path: "/dashboard/inbox",
    icon: <MessageSquare className="w-5 h-5 text-primary" />,
    position: "right",
  },
  {
    id: "objections",
    title: "Objection Handling",
    description: "Configure how the AI responds to specific customer objections. Fine-tune your sales strategy.",
    targetSelector: "[data-testid='nav-item-objections']",
    path: "/dashboard/objections",
    icon: <Shield className="w-5 h-5 text-primary" />,
    position: "right",
  },
  {
    id: "analytics",
    title: "Analytics",
    description: "Track your revenue recovery performance, ROI, and engagement metrics at a glance.",
    targetSelector: "[data-testid='nav-item-analytics']",
    path: "/dashboard/analytics",
    icon: <BarChart3 className="w-5 h-5 text-primary" />,
    position: "right",
  },
  {
    id: "done",
    title: "You're All Set",
    description: "You're ready to start recovering revenue! Click 'Finish' to close this tour.",
    icon: <Check className="w-5 h-5 text-emerald-400" />,
    position: "center",
  },
];

interface GuidedTourProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function GuidedTour({ isOpen, onComplete, onSkip }: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [location, setLocation] = useLocation();
  const step = TOUR_STEPS[currentStep];

  // Auto-navigation and element finding
  useEffect(() => {
    if (!isOpen) return;

    // Navigate if the step requires a specific path and we're not there
    if (step.path && location !== step.path) {
      setLocation(step.path);
    }

    const findTarget = () => {
      if (step.targetSelector) {
        const element = document.querySelector(step.targetSelector);
        if (element) {
          const rect = element.getBoundingClientRect();
          // Check if element is visible
          if (rect.width > 0 && rect.height > 0) {
            setTargetRect((prev) => {
              if (
                prev &&
                Math.abs(prev.top - rect.top) < 1 &&
                Math.abs(prev.left - rect.left) < 1 &&
                Math.abs(prev.width - rect.width) < 1 &&
                Math.abs(prev.height - rect.height) < 1
              ) {
                return prev;
              }
              return rect;
            });
            return;
          }
        }
      }
      setTargetRect(null); // Fallback to center if not found
    };

    // Scroll into view only once when step changes
    const initialScroll = () => {
      if (step.targetSelector) {
        const element = document.querySelector(step.targetSelector);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    };

    // Increase delay to ensure DOM is ready
    const timer = setTimeout(() => {
      initialScroll();
      findTarget();
    }, 500);
    
    // Observers
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    window.addEventListener("resize", findTarget);
    window.addEventListener("scroll", findTarget);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", findTarget);
      window.removeEventListener("scroll", findTarget);
    };
  }, [isOpen, currentStep, step, location, setLocation]);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const getPopoverStyle = () => {
    // Force center alignment on mobile devices to prevent clipping or off-screen rendering
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (isMobile || !targetRect || step.position === 'center') {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const gap = 16;
    let top = 0;
    let left = 0;

    switch (step.position) {
      case 'right':
        top = targetRect.top + (targetRect.height / 2) - 100; // Approximate center
        left = targetRect.right + gap;
        break;
      case 'left':
        top = targetRect.top + (targetRect.height / 2) - 100;
        left = targetRect.left - 400 - gap; // Width is max 400
        break;
      case 'bottom':
        top = targetRect.bottom + gap;
        left = targetRect.left + (targetRect.width / 2) - 200;
        break;
      case 'top':
        top = targetRect.top - 200 - gap; // Approx height
        left = targetRect.left + (targetRect.width / 2) - 200;
        break;
      default:
        return {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        };
    }

    // Boundary checks (basic)
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    if (window.innerWidth - left < 410) left = window.innerWidth - 420; // Keep it on screen

    return { top, left };
  };

  if (!isOpen) return null;

  const popoverStyle = getPopoverStyle();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const isCentered = isMobile || !targetRect || step.position === 'center';

  return createPortal(
    <AnimatePresence mode="wait">
      <div className="fixed inset-0 z-[9999] pointer-events-none">
        
        {/* Semi-transparent overlay for mobile or centered steps, but much lighter/localized */}
        {isCentered && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-auto"
            />
        )}

        {/* Target Highlighter (Glow) - Non-blurring */}
        {targetRect && !isCentered && (
          <motion.div
            layoutId="target-glow"
            className="absolute border-2 border-primary/50 shadow-[0_0_30px_rgba(0,255,255,0.3)] rounded-xl pointer-events-none"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ 
                opacity: 1, 
                scale: 1,
                top: targetRect.top - 4,
                left: targetRect.left - 4,
                width: targetRect.width + 8,
                height: targetRect.height + 8,
            }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
          />
        )}

        {/* Popover Card */}
        <motion.div
          key={currentStep}
          initial={isMobile ? { opacity: 0, y: 20 } : { opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={isMobile ? { opacity: 0, y: 20 } : { opacity: 0, scale: 0.95, y: 10 }}
          transition={isMobile ? { duration: 0.2 } : { type: "spring", stiffness: 300, damping: 30 }}
          className={cn(
            "fixed pointer-events-auto w-full max-w-[340px] md:max-w-[380px] p-5 md:p-6 glass-card rounded-2xl border border-white/10 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)] bg-[#0A0A0A]/95 backdrop-blur-xl",
            isCentered ? "" : "transition-all duration-300 ease-out"
          )}
          style={popoverStyle}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                {step.icon}
              </div>
              <div>
                <h4 className="font-bold text-white text-base tracking-tight">{step.title}</h4>
                <p className="text-[10px] text-primary/60 font-bold uppercase tracking-widest leading-none mt-1">
                  Step {currentStep + 1} of {TOUR_STEPS.length}
                </p>
              </div>
            </div>
            <button
              onClick={onSkip}
              className="p-1.5 hover:bg-white/5 rounded-full transition-colors group"
              title="Close tour"
            >
              <X className="w-4 h-4 text-white/30 group-hover:text-white" />
            </button>
          </div>

          {/* Content */}
          <p className="text-white/70 text-sm leading-relaxed mb-6 font-medium">
            {step.description}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <div className="flex gap-1">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === currentStep ? 'w-6 bg-primary' : 'w-1.5 bg-white/10'}`}
                />
              ))}
            </div>
            <Button
              onClick={handleNext}
              size="sm"
              className="h-9 px-5 rounded-lg bg-primary text-black font-bold hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20"
            >
              {currentStep === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
              <ChevronRight className="ml-1.5 w-3.5 h-3.5" />
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}

export function useTour(onboardingCompleted: boolean = false) {
  const [showTour, setShowTour] = useState(false);
  const queryClient = useQueryClient();

  const { data: user } = useQuery<any>({
    queryKey: ["/api/user/profile"],
    enabled: !!onboardingCompleted,
  });

  const updateMetadata = useMutation({
    mutationFn: async (metadata: any) => {
      return await apiRequest("POST", "/api/user/auth/metadata", { metadata });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    }
  });

  useEffect(() => {
    // Only show if onboarding is explicitly completed
    if (!onboardingCompleted) {
      setShowTour(false);
      return;
    }

    // Check localStorage first (fastest)
    const localTourCompleted = localStorage.getItem("audnixTourCompleted") === "true";
    if (localTourCompleted) return;

    // Then check user metadata
    const userTourCompleted = user?.metadata?.tourCompleted === true;
    if (userTourCompleted) {
       localStorage.setItem("audnixTourCompleted", "true"); // Sync local
       return;
    }

    // If neither, trigger tour
    const timer = setTimeout(() => {
      setShowTour(true);
    }, 1500); // Slight delay for page load
    return () => clearTimeout(timer);

  }, [onboardingCompleted, user]);

  const completeTour = useCallback(() => {
    localStorage.setItem("audnixTourCompleted", "true");
    updateMetadata.mutate({ tourCompleted: true });
    setShowTour(false);
  }, [updateMetadata]);

  const skipTour = useCallback(() => {
    localStorage.setItem("audnixTourCompleted", "true");
    updateMetadata.mutate({ tourCompleted: true });
    setShowTour(false);
  }, [updateMetadata]);

  const replayTour = useCallback(() => {
    localStorage.removeItem("audnixTourCompleted");
    setShowTour(true);
  }, []);

  return { showTour, completeTour, skipTour, replayTour };
}
