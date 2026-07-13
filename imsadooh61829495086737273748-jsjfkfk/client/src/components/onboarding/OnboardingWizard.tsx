import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Rocket,
  Users,
  Code,
  Briefcase,
  Building,
  Search,
  Check,
  ChevronRight,
  Zap
} from "lucide-react";
import { useReducedMotion } from "@/lib/animation-utils";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";

const USER_ROLES = [
  { value: 'creator', label: 'Content Creator', icon: Sparkles, description: 'Influencer, YouTuber, or creator' },
  { value: 'founder', label: 'Founder / CEO', icon: Rocket, description: 'Building or running a business' },
  { value: 'developer', label: 'Developer', icon: Code, description: 'Building products and tools' },
  { value: 'agency', label: 'Agency', icon: Building, description: 'Managing multiple clients' },
  { value: 'freelancer', label: 'Freelancer', icon: Briefcase, description: 'Independent consultant or service provider' },
  { value: 'other', label: 'Other', icon: Users, description: 'Something else' },
];

const SOURCES = [
  'Twitter/X',
  'LinkedIn',
  'YouTube',
  'Google Search',
  'Friend Referral',
  'Reddit',
  'Facebook',
  'TikTok',
  'Product Hunt',
  'Indie Hackers',
  'Other',
];

const USE_CASES = [
  'Automate lead follow-ups',
  'Close more deals',
  'Automate conversations',
  'Never miss a lead',
  'Scale my outreach',
  'Improve response time',
  'Book more meetings',
  'Learn about AI sales',
];

const BUSINESS_SIZES = [
  { value: 'solo', label: 'Solo (just me)', description: 'Working independently' },
  { value: 'small_team', label: 'Small Team', description: '2-10 people' },
  { value: 'medium', label: 'Medium Business', description: '11-50 people' },
  { value: 'enterprise', label: 'Enterprise', description: '50+ people' },
];

interface OnboardingWizardProps {
  isOpen: boolean;
  onComplete: () => void;
}

export const OnboardingWizard = React.memo(function OnboardingWizard({ isOpen, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [userRole, setUserRole] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [customSource, setCustomSource] = useState<string>('');
  const [useCase, setUseCase] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [businessSize, setBusinessSize] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const { toast } = useToast();

  const handleRoleSelect = (role: string) => {
    setUserRole(role);
    setTimeout(() => setStep(2), 300);
  };

  const handleSourceSelect = (selectedSource: string) => {
    setSource(selectedSource);
    if (selectedSource !== 'Other') {
      setTimeout(() => setStep(3), 300);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleUseCaseNext = () => {
    if (selectedTags.length === 0 && !useCase.trim()) {
      toast({
        title: "Please select at least one use case",
        variant: "destructive",
      });
      return;
    }
    setStep(4);
  };

  const handleBusinessSizeSelect = (size: string) => {
    setBusinessSize(size);
    setTimeout(() => setStep(5), 500);
  };

  const handleCompanyNameSubmit = async () => {
    if (!companyName.trim()) {
      toast({
        title: "Please enter your company name",
        variant: "destructive",
      });
      return;
    }
    await handleComplete();
  };

  const handleComplete = async () => {
    setLoading(true);

    try {
      await apiClient('/api/auth/username/complete-onboarding', {
        method: 'POST',
        body: JSON.stringify({
          userRole,
          source: source === 'Other' ? customSource : source,
          useCase: useCase || selectedTags.join(', '),
          businessSize,
          tags: selectedTags,
          companyName: companyName.trim(),
        }),
      });

      toast({
        title: "Welcome to Audnix! 🎉",
        description: "You're all set. Let's start closing deals!",
      });

      // Set instantaneous flag to prevent flicker on reload
      localStorage.setItem('onboarding_completed', 'true');

      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (error: any) {
      console.error('Onboarding error:', error);
      const status = error?.response?.status || error?.status;
      const errorMessage = error?.response?.data?.error || error?.message || "Unknown error";
      const isAuthError = status === 401 || errorMessage.toLowerCase().includes("session") || errorMessage.toLowerCase().includes("log in");

      if (isAuthError) {
        toast({
          title: "Session expired",
          description: "Please refresh the page and log in again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Something went wrong",
          description: "We couldn't save your profile. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 200 : -200,
      opacity: 0,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 200 : -200,
      opacity: 0,
    }),
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => { }}>
      <style>{`
        .onboarding-modal [data-radix-dialog-close] { display: none !important; }
        .onboarding-modal > button.absolute { display: none !important; }
      `}</style>
      <DialogContent className="w-[calc(100vw-24px)] max-w-md max-h-[90vh] overflow-hidden flex flex-col p-0 onboarding-modal rounded-2xl glass-premium border border-primary/20 shadow-2xl">

        {/* Thin progress bar at the very top */}
        <div className="h-0.5 bg-muted shrink-0">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: '0%' }}
            animate={{ width: `${(step / 5) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Step counter header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
            {step === 0 ? 'Welcome' : `Step ${step} of 5`}
          </span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className={`h-1 w-4 rounded-full transition-colors duration-300 ${i <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
        </div>

        {/* Scrollable step content */}
        <div className="overflow-y-auto flex-1 px-4 pb-5 pt-1">
          <AnimatePresence mode="wait" custom={1}>
            <motion.div
              key={`step-${step}`}
              custom={1}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className={step === 0 ? "flex flex-col items-center text-center gap-4 py-4" : "space-y-4 py-2"}
            >
              {/* ── Step 0: Welcome ──────────────────────────── */}
              {step === 0 && (
                <>
                <div className="relative w-14 h-14">
                  <motion.div
                    className="absolute inset-0 rounded-full bg-primary/20 blur-lg"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <div className="relative w-14 h-14 rounded-full border-2 border-primary/50 flex items-center justify-center bg-background/80">
                    <Zap className="w-7 h-7 text-primary animate-pulse" />
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white">You're in. Let's set up.</h2>
                  <p className="text-white/50 text-sm mt-1 max-w-xs mx-auto leading-snug">
                    Takes 60 seconds. Helps us personalize your AI engine.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                  <div className="p-2.5 rounded-xl bg-muted/30 border border-white/5 text-center">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Status</p>
                    <p className="text-cyan-500 font-bold text-sm">ACTIVE</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-muted/30 border border-white/5 text-center">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Latency</p>
                    <p className="text-primary font-bold text-sm">14ms</p>
                  </div>
                </div>

                <Button
                  onClick={() => setStep(1)}
                  className="w-full max-w-xs h-11 rounded-xl font-bold bg-cyan-500 text-black hover:bg-cyan-400 group text-xs uppercase tracking-wider"
                >
                  Begin Setup
                  <ChevronRight className="ml-1.5 w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Button>
                </>
              )}

              {/* ── Step 1: Role ─────────────────────────────── */}
              {step === 1 && (
                <>
                <div className="text-center mb-3">
                  <h2 className="text-lg font-bold text-white">What's your role?</h2>
                  <p className="text-white/50 text-xs mt-0.5">Pick the one that fits best</p>
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  {USER_ROLES.map((role) => (
                    <button
                      key={role.value}
                      onClick={() => handleRoleSelect(role.value)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        userRole === role.value
                          ? 'border-primary bg-primary/10'
                          : 'border-border/60 hover:border-primary/50 hover:bg-muted/30'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg shrink-0 ${userRole === role.value ? 'bg-primary/20' : 'bg-muted/50'}`}>
                        <role.icon className={`w-4 h-4 ${userRole === role.value ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm leading-tight">{role.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{role.description}</p>
                      </div>
                      {userRole === role.value && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
                </>
              )}

              {/* ── Step 2: Source ───────────────────────────── */}
              {step === 2 && (
                <>
                <div className="text-center mb-3">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-cyan-500/10 mb-2">
                    <Search className="w-5 h-5 text-cyan-500" />
                  </div>
                  <h2 className="text-lg font-bold text-white">How'd you find us?</h2>
                  <p className="text-white/50 text-xs mt-0.5">Tap one to continue</p>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {SOURCES.map((src) => (
                    <button
                      key={src}
                      onClick={() => handleSourceSelect(src)}
                      className={`py-2.5 px-1.5 rounded-xl border text-center text-xs font-semibold transition-all leading-tight ${
                        source === src
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 hover:border-primary/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {src}
                    </button>
                  ))}
                </div>

                {source === 'Other' && (
                  <div className="space-y-2 pt-1">
                    <Input
                      id="customSource"
                      placeholder="Where did you find us?"
                      value={customSource}
                      onChange={(e) => setCustomSource(e.target.value)}
                      autoFocus
                      className="h-11 rounded-xl text-sm border-border/40 hover:border-primary/40 focus-visible:ring-primary/20 bg-background/50"
                    />
                    <Button
                      onClick={() => setStep(3)}
                      className="w-full h-11 rounded-xl font-bold text-xs uppercase tracking-wider"
                      disabled={!customSource.trim()}
                    >
                      Continue →
                    </Button>
                  </div>
                )}
                </>
              )}

              {/* ── Step 3: Use Case ─────────────────────────── */}
              {step === 3 && (
                <>
                <div className="text-center mb-3">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mb-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-lg font-bold">What's your goal?</h2>
                  <p className="text-muted-foreground text-xs mt-0.5">Select all that apply</p>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {USE_CASES.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => handleTagToggle(tag)}
                      className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all leading-tight ${
                        selectedTags.includes(tag)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 hover:border-primary/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span>{tag}</span>
                        {selectedTags.includes(tag) && <Check className="w-3 h-3 shrink-0 mt-0.5" />}
                      </div>
                    </button>
                  ))}
                </div>

                <Input
                  id="customUseCase"
                  placeholder="Or describe in your own words (optional)"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  className="h-11 rounded-xl text-sm border-border/40 hover:border-primary/40 focus-visible:ring-primary/20 bg-background/50"
                />

                <Button onClick={handleUseCaseNext} className="w-full h-11 rounded-xl font-bold text-xs uppercase tracking-wider">
                  Continue →
                </Button>
                </>
              )}

              {/* ── Step 4: Business Size ────────────────────── */}
              {step === 4 && (
                <>
                <div className="text-center mb-3">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mb-2">
                    <Building className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-lg font-bold">Team size?</h2>
                  <p className="text-muted-foreground text-xs mt-0.5">Tap one to continue</p>
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  {BUSINESS_SIZES.map((size) => (
                    <button
                      key={size.value}
                      onClick={() => handleBusinessSizeSelect(size.value)}
                      disabled={loading}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        businessSize === size.value
                          ? 'border-primary bg-primary/10'
                          : 'border-border/60 hover:border-primary/50 hover:bg-muted/20'
                      }`}
                    >
                      <div>
                        <p className="font-semibold text-sm">{size.label}</p>
                        <p className="text-xs text-muted-foreground">{size.description}</p>
                      </div>
                      {businessSize === size.value && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
                </>
              )}

              {/* ── Step 5: Company Name ─────────────────────── */}
              {step === 5 && (
                <>
                <div className="text-center mb-3">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-cyan-500/10 mb-2">
                    <Zap className="w-5 h-5 text-cyan-500" />
                  </div>
                  <h2 className="text-lg font-bold text-white">Last thing — your company</h2>
                  <p className="text-white/50 text-xs mt-0.5">What should we call your business?</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyName" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Company Name
                  </Label>
                  <Input
                    id="companyName"
                    placeholder="e.g. Acme Corp"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    autoFocus
                    disabled={loading}
                    className="h-11 rounded-xl text-sm border-border/40 hover:border-primary/40 focus-visible:ring-primary/20 bg-background/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCompanyNameSubmit();
                    }}
                  />
                </div>

                <Button
                  onClick={handleCompanyNameSubmit}
                  className="w-full h-11 rounded-xl font-bold text-xs uppercase tracking-wider"
                  disabled={loading || !companyName.trim()}
                >
                  {loading ? "Setting up…" : "Complete Setup 🎉"}
                </Button>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
});
