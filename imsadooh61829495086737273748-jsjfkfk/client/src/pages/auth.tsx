import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Shield, Lock, Eye, EyeOff, Mail, Loader2, ArrowRight, User as UserIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useUser } from "@/hooks/use-user";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { useToast } from "@/hooks/use-toast";
import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

const options = {
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  translations: zxcvbnEnPackage.translations,
};
zxcvbnOptions.setOptions(options);

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { data: user } = useUser();
  const { toast } = useToast();

  // Signup flow: 1 = Email+Password, 2 = OTP/Skip, 3 = Username, 4 = Success
  const [signupStep, setSignupStep] = useState(1);
  const [isLogin, setIsLogin] = useState(() => {
    return location === "/login" || window.location.pathname === "/login";
  });
  const isDedicatedPage = location === "/login" || location === "/signup" || window.location.pathname === "/login" || window.location.pathname === "/signup";

  // Sync isLogin state when route changes
  useEffect(() => {
    if (location === "/login") {
      setIsLogin(true);
    } else if (location === "/signup") {
      setIsLogin(false);
    }
  }, [location]);

  // Set document title dynamically for SEO
  useEffect(() => {
    document.title = isLogin 
      ? "Login | Audnix AI - Enterprise Outreach Platform" 
      : "Sign Up | Audnix AI - Enterprise Outreach Platform";
  }, [isLogin]);

  // Form state
  // Auto-fill email from URL if present
  const [email, setEmail] = useState(() => {
    const params = new URLSearchParams(search);
    return params.get("email") || "";
  });

  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [showRedirectPopup, setShowRedirectPopup] = useState(false);
  const [showResetOption, setShowResetOption] = useState(false);
  const [resetUsed, setResetUsed] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [otpEnabled, setOtpEnabled] = useState(false); // Default false until server confirms

  // Forgot password state
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1 = Request, 2 = Verify & Reset
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleForgotRequest = async () => {
    if (!forgotEmail) {
      toast({
        title: "Missing Information",
        description: "Please enter your email address",
        variant: "destructive",
      });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch('/api/user/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        setForgotStep(2);
        toast({
          title: "Recovery Code Sent",
          description: data.message || "Please check your email for the reset code",
        });
      } else {
        toast({
          title: "Failed to Request Reset",
          description: data.error || "Could not process password reset request",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to request password reset",
        variant: "destructive",
      });
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotReset = async () => {
    if (!forgotEmail || !forgotOtp || !newPassword) {
      toast({
        title: "Missing Information",
        description: "Please fill in all recovery fields",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        title: "Weak Password",
        description: "New password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch('/api/user/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail,
          otp: forgotOtp,
          newPassword
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Password Reset Successful",
          description: "Your password has been updated. You can now log in.",
        });
        setIsForgotPassword(false);
        setIsLogin(true);
        setForgotStep(1);
        setPassword("");
        setForgotOtp("");
        setNewPassword("");
      } else {
        toast({
          title: "Reset Failed",
          description: data.error || "Invalid verification code or expired session",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to reset password",
        variant: "destructive",
      });
    } finally {
      setForgotLoading(false);
    }
  };

  // Check if reset was already used for this email
  useEffect(() => {
    if (email && email.includes('@')) {
      const resetKey = `audnix_reset_used_${email.toLowerCase()}`;
      const wasReset = localStorage.getItem(resetKey);
      setResetUsed(!!wasReset);
      setShowResetOption(!wasReset && isLogin);
    } else {
      setShowResetOption(false);
    }
  }, [email, isLogin]);

  // Self-service account reset handler
  const handleSelfReset = async () => {
    if (!email || !email.includes('@')) {
      toast({
        title: "Email Required",
        description: "Enter your email first",
        variant: "destructive",
      });
      return;
    }

    setResetLoading(true);
    try {
      const response = await fetch('/api/user/auth/reset-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        // Mark as used in localStorage (one-time use)
        const resetKey = `audnix_reset_used_${email.toLowerCase()}`;
        localStorage.setItem(resetKey, new Date().toISOString());
        setResetUsed(true);
        setShowResetOption(false);

        toast({
          title: "Account Reset",
          description: data.action === 'signup'
            ? "You can now sign up fresh"
            : "Login with your password to start fresh",
        });

        // Switch to signup mode
        setIsLogin(false);
        setSignupStep(1);
        setPassword("");
      } else {
        toast({
          title: "Reset Failed",
          description: data.error || "Could not reset account",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reset account",
        variant: "destructive",
      });
    } finally {
      setResetLoading(false);
    }
  };

  // Debounce password strength calculation to reduce lag
  const [passwordStrength, setPasswordStrength] = useState<any>(null);

  useEffect(() => {
    if (!password) {
      setPasswordStrength(null);
      return;
    }

    // Only calculate strength after user stops typing (300ms delay)
    const timer = setTimeout(() => {
      setPasswordStrength(zxcvbn(password));
    }, 300);

    return () => clearTimeout(timer);
  }, [password]);

  useEffect(() => {
    if (user) {
      const lastActive = localStorage.getItem('auth_last_active');
      if (lastActive && Date.now() - Number(lastActive) < 3600000) {
        setLocation("/dashboard");
      } else {
        localStorage.removeItem('auth_last_active');
      }
    }
  }, [user, setLocation]);

  // Check OTP status and incomplete setup on page load
  useEffect(() => {
    const checkOtpStatus = async () => {
      try {
        const response = await fetch('/api/user/auth/otp-status', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setOtpEnabled(data.otpEnabled);
        }
      } catch (error) {
        // OTP status check failed, defaulting to enabled
      }
    };
    checkOtpStatus();
  }, []);

  // Check for incomplete setup on page load
  useEffect(() => {
    const checkIncompleteSetup = async () => {
      try {
        const response = await fetch('/api/user/auth/check-state', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();

          if (data.authenticated && data.incompleteSetup) {
            // User is logged in but has incomplete setup
            const { nextStep, suggestedUsername, restoreState } = data;

            if (nextStep === 'username' && restoreState?.step === 3) {
              setIsLogin(false);
              setSignupStep(3);
              setEmail(restoreState.email || '');
              setUsername(suggestedUsername || '');

              toast({
                title: "Welcome Back!",
                description: "Complete your username to continue",
              });
            } else if (nextStep === 'onboarding') {
              // Redirect to onboarding
              window.location.href = '/onboarding';
            }
          }
        }
      } catch (error) {
        // Silently fail - user can still proceed normally
      }
    };

    checkIncompleteSetup();
  }, []);

  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  const getPasswordStrengthColor = () => {
    if (!passwordStrength) return 'bg-gray-200';
    const score = passwordStrength.score;
    if (score === 0) return 'bg-red-500';
    if (score === 1) return 'bg-orange-500';
    if (score === 2) return 'bg-yellow-500';
    if (score === 3) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const getPasswordStrengthTextColor = () => {
    if (!passwordStrength) return '#9ca3af';
    const score = passwordStrength.score;
    if (score === 0) return '#ef4444';
    if (score === 1) return '#f97316';
    if (score === 2) return '#eab308';
    if (score === 3) return '#3b82f6';
    return '#22c55e';
  };

  const getPasswordStrengthText = () => {
    if (!passwordStrength) return '';
    const score = passwordStrength.score;
    if (score === 0) return 'Very Weak';
    if (score === 1) return 'Weak';
    if (score === 2) return 'Fair';
    if (score === 3) return 'Good';
    return 'Strong';
  };

  // LOGIN
  const handleLogin = async () => {
    if (!email || !password) {
      toast({
        title: "Missing Information",
        description: "Please enter email and password",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    let loginSuccess = false;

    try {
      const response = await fetch('/api/user/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      // Handle network errors
      if (!response) {
        throw new Error("No response from server");
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({
          title: "Login Failed",
          description: data.error || "Invalid credentials",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      loginSuccess = true;

      // Check if account setup is incomplete and restore state
      if (data.incompleteSetup && data.restoreState) {
        const { message } = data.restoreState;

        toast({
          title: "Welcome Back!",
          description: message || "Continue where you left off",
        });

        setLoading(false);

        localStorage.setItem('auth_last_active', Date.now().toString());

        // Route correctly based on the nextStep needed
        setTimeout(() => {
          if (data.nextStep === 'username') {
            setIsLogin(false);
            setSignupStep(3);
            setEmail(data.restoreState.email || '');
            setUsername(data.suggestedUsername || '');
          } else if (data.nextStep === 'onboarding') {
            window.location.href = '/onboarding';
          } else {
            window.location.href = '/dashboard';
          }
        }, 500);
        return;
      }

      localStorage.setItem('auth_last_active', Date.now().toString());

      // Invalidate user cache so dashboard's AuthGuard sees the logged-in user
      queryClient.invalidateQueries({ queryKey: ['user'] });

      toast({
        title: "Welcome back!",
        description: "Redirecting to dashboard...",
      });

      // Direct redirect after successful login
      setTimeout(() => {
        setLocation('/dashboard');
      }, 500);
    } catch (error: any) {
      console.error("Login error:", error);

      // If login succeeded but verification failed, still allow manual refresh
      if (loginSuccess) {
        toast({
          title: "Login Successful",
          description: "Refresh the page to continue",
        });
      } else {
        toast({
          title: "Connection Error",
          description: "Please check your internet and try again",
          variant: "destructive",
        });
      }
      setLoading(false);
    }
  };

  // SIGNUP STEP 1: Email + Password (goes to OTP step if enabled, or username step if disabled)
  const handleSignupStep1 = async () => {
    if (!email || !password) {
      toast({
        title: "Missing Information",
        description: "Please enter email and password",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Weak Password",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    // If OTP is disabled, skip to username step (step 3)
    if (!otpEnabled) {
      setSignupStep(3);
      toast({
        title: "Almost There!",
        description: "Now choose a username for your account",
      });
      return;
    }

    // OTP is enabled - request OTP as usual
    setLoading(true);
    try {
      const response = await fetch('/api/user/auth/signup/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        // Server may indicate OTP is disabled or setup is incomplete
        if (data.otpEnabled === false || data.directSignupAvailable) {
          setOtpEnabled(false);
          setSignupStep(3);
          toast({
            title: "Almost There!",
            description: "Now choose a username for your account",
          });
          setLoading(false);
          return;
        }
        if (data.incompleteSetup || data.useLogin) {
          toast({
            title: "Account Exists",
            description: "An account with this email exists but setup is incomplete. Please log in to continue.",
          });
          setLocation("/login");
          setLoading(false);
          return;
        }
        setSignupStep(2);
        setResendCountdown(60);
        toast({
          title: "Code Sent",
          description: "Check your inbox for a verification code",
        });
      } else {
        toast({
          title: "Request Failed",
          description: data.error || "Could not send verification code",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to send verification code",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // RESEND OTP (separate from initial request - doesn't re-send password)
  const handleResendOTP = async () => {
    if (!email) return;

    setLoading(true);
    try {
      const response = await fetch('/api/user/auth/signup/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include',
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        setResendCountdown(60);
        toast({
          title: "Code Resent",
          description: "A new verification code has been sent",
        });
      } else {
        toast({
          title: "Resend Failed",
          description: data.error || "Could not resend code",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to resend code",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // SIGNUP STEP 2: Verify OTP
  const handleSignupStep2 = async () => {
    if (!otp || otp.length < 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter the 6-digit code",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/user/auth/signup/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
        credentials: 'include',
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        setSignupStep(3);
        toast({
          title: "Verified",
          description: "Now choose a username for your account",
        });
      } else {
        toast({
          title: "Verification Failed",
          description: data.error || "Invalid or expired code",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to verify code",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // SIGNUP STEP 3: Set Username & Complete
  const handleSignupStep3 = async () => {
    if (!username || username.length < 3) {
      toast({
        title: "Invalid Username",
        description: "Username must be at least 3 characters",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Use direct signup if OTP is disabled, otherwise use the normal complete flow
      const endpoint = !otpEnabled 
        ? '/api/user/auth/signup/direct' 
        : '/api/user/auth/signup/complete';
      
      const body = !otpEnabled 
        ? { email, password, username }  // Direct signup needs password
        : { email, username, otp };       // Normal flow uses OTP

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        localStorage.setItem('auth_last_active', Date.now().toString());

        toast({
          title: "Account Created",
          description: "Welcome to Audnix AI!",
        });

        // Final login to establish session
        setTimeout(() => {
          setLocation('/dashboard');
        }, 500);
      } else {
        toast({
          title: "Setup Failed",
          description: data.error || "Could not complete account setup",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to complete setup",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 font-sans text-foreground overflow-hidden relative">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0b] via-[#0f172a] to-[#0a0a0b] pointer-events-none" />
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <div className="mb-8 text-center">
          <motion.a
            href="/"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center gap-3 mb-4"
          >
            <img src="/logo.svg" alt="Audnix AI" className="h-10 w-auto" />
            <span className="text-2xl font-bold tracking-tight text-foreground">Audnix AI</span>
          </motion.a>
          <p className="text-muted-foreground">
            {isLogin ? "Sign in to your account" : signupStep === 2 ? "Verify your email" : signupStep === 3 ? "Complete your profile" : "Create your account"}
          </p>
        </div>

        <Card className="bg-card/50 border-border backdrop-blur-xl shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />

          <CardHeader className="pb-4">
            {isForgotPassword ? (
              <div className="flex justify-between items-center w-full">
                <div>
                  <CardTitle className="text-xl font-bold text-white">Reset Password</CardTitle>
                  <CardDescription className="text-white/60 text-xs mt-1">
                    {forgotStep === 1
                      ? "Get a recovery verification code"
                      : "Enter the code and choose a new password"}
                  </CardDescription>
                </div>
                <button
                  onClick={() => setIsForgotPassword(false)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Back to Login
                </button>
              </div>
            ) : isDedicatedPage ? (
              <div className="text-center py-2">
                <CardTitle className="text-2xl font-bold text-white tracking-tight">
                  {isLogin ? "Sign In" : "Register"}
                </CardTitle>
                <CardDescription className="text-white/60 text-xs mt-1.5">
                  {isLogin 
                    ? "Welcome back! Access your outreach workspace." 
                    : "Create your free account to get started."}
                </CardDescription>
              </div>
            ) : (
              <div className="flex p-1 bg-white/5 rounded-lg border border-white/10">
                <button
                  onClick={() => { setIsLogin(true); setSignupStep(1); }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${isLogin ? "bg-primary text-white shadow-lg" : "text-white/60 hover:text-white"}`}
                >
                  Login
                </button>
                <button
                  onClick={() => setIsLogin(false)}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${!isLogin ? "bg-primary text-white shadow-lg" : "text-white/60 hover:text-white"}`}
                >
                  Register
                </button>
              </div>
            )}
          </CardHeader>

          <CardContent className="text-card-foreground">
            <AnimatePresence mode="wait">
              {isForgotPassword ? (
                <motion.div
                  key="forgot"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="space-y-4 text-white"
                >
                  {forgotStep === 1 ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="f-email">Email Address</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                          <Input
                            id="f-email"
                            type="email"
                            value={forgotEmail}
                            onChange={(e) => setForgotEmail(e.target.value)}
                            placeholder="name@company.com"
                            className="pl-10 bg-white/5 border-white/10 focus:border-primary/50 text-white"
                          />
                        </div>
                      </div>
                      <Button
                        onClick={handleForgotRequest}
                        disabled={forgotLoading}
                        className="w-full h-11 bg-primary hover:bg-primary/90 text-white"
                      >
                        {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Send Recovery Code
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2 text-center mb-2">
                        <p className="text-xs text-white/60">
                          We sent a recovery code to <span className="text-white font-medium">{forgotEmail}</span>
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="f-otp">Verification Code</Label>
                        <Input
                          id="f-otp"
                          placeholder="000000"
                          value={forgotOtp}
                          onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          className="text-center text-2xl tracking-[0.5em] h-14 bg-white/5 border-white/10 font-mono focus:border-primary/50 text-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="f-password">New Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                          <Input
                            id="f-password"
                            type={showPassword ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="••••••••"
                            className="pl-10 pr-10 bg-white/5 border-white/10 focus:border-primary/50 text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4 text-white/40" /> : <Eye className="w-4 h-4 text-white/40" />}
                          </button>
                        </div>
                      </div>
                      <Button
                        onClick={handleForgotReset}
                        disabled={forgotLoading || forgotOtp.length !== 6 || newPassword.length < 8}
                        className="w-full h-11 bg-primary hover:bg-primary/90 text-white"
                      >
                        {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Reset Password
                      </Button>
                      <button
                        onClick={handleForgotRequest}
                        disabled={forgotLoading}
                        className="w-full text-xs text-primary hover:underline text-center mt-2"
                      >
                        Didn't get code? Resend
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : isLogin ? (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="pl-10 bg-white/5 border-white/10 focus:border-primary/50 text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="password">Password</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsForgotPassword(true);
                          setForgotStep(1);
                          setForgotEmail(email);
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="pl-10 pr-10 bg-white/5 border-white/10 focus:border-primary/50 text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4 text-white/40" /> : <Eye className="w-4 h-4 text-white/40" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    onClick={handleLogin}
                    disabled={loading}
                    className="w-full h-11 bg-primary hover:bg-primary/90 text-white"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Sign In
                  </Button>

                  {showResetOption && (
                    <div className="pt-4 border-t border-white/10 text-center">
                      <p className="text-xs text-muted-foreground mb-2">Trouble logging in?</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSelfReset}
                        disabled={resetLoading}
                        className="text-xs text-primary hover:text-primary/80 hover:bg-primary/10"
                      >
                        {resetLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        Reset this account (Clear previous data)
                      </Button>
                    </div>
                  )}

                  {isDedicatedPage && (
                    <div className="text-center pt-2">
                      <p className="text-xs text-white/40">
                        Don't have an account?{" "}
                        <button
                          type="button"
                          onClick={() => setLocation("/signup")}
                          className="text-primary hover:underline font-semibold"
                        >
                          Register here
                        </button>
                      </p>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="signup"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-4"
                >
                  {signupStep === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="s-email">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                          <Input
                            id="s-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com"
                            className="pl-10 bg-white/5 border-white/10 focus:border-primary/50"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="s-password">Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                          <Input
                            id="s-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="pl-10 pr-10 bg-white/5 border-white/10 focus:border-primary/50"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4 text-white/40" /> : <Eye className="w-4 h-4 text-white/40" />}
                          </button>
                        </div>
                        {passwordStrength && (
                          <div className="space-y-1 pt-1">
                            <div className="flex justify-between text-[10px] uppercase tracking-wider font-bold">
                              <span className="text-white/40">Strength:</span>
                              <span style={{ color: getPasswordStrengthTextColor() }}>{getPasswordStrengthText()}</span>
                            </div>
                            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-500 ${getPasswordStrengthColor()}`}
                                style={{ width: `${(passwordStrength.score + 1) * 20}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      <Button onClick={handleSignupStep1} disabled={loading} className="w-full h-11 bg-primary hover:bg-primary/90">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Continue <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>

                      {isDedicatedPage && (
                        <div className="text-center pt-2">
                          <p className="text-xs text-white/40">
                            Already have an account?{" "}
                            <button
                              type="button"
                              onClick={() => setLocation("/login")}
                              className="text-primary hover:underline font-semibold"
                            >
                              Sign In
                            </button>
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {signupStep === 2 && (
                    <div className="space-y-4">
                      <div className="text-center mb-4">
                        <div className="inline-flex p-3 rounded-full bg-primary/10 mb-2">
                          <Mail className="w-6 h-6 text-primary" />
                        </div>
                        <h2 className="text-lg font-semibold"> Check your inbox </h2>
                        <p className="text-sm text-white/60"> We sent a code to <span className="text-white font-medium">{email}</span> </p>
                      </div>
                      <div className="space-y-2">
                        <Input
                          placeholder="000000"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          className="text-center text-2xl tracking-[0.5em] h-14 bg-white/5 border-white/10 font-mono focus:border-primary/50"
                        />
                      </div>
                      <Button
                        onClick={handleSignupStep2}
                        disabled={loading || otp.length !== 6}
                        className="w-full h-11"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Verify Code
                      </Button>
                      <button
                        onClick={handleResendOTP}
                        disabled={resendCountdown > 0 || loading}
                        className="w-full text-sm text-primary hover:underline disabled:text-white/40"
                      >
                        {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : "Didn't receive a code? Resend"}
                      </button>
                    </div>
                  )}

                  {signupStep === 3 && (
                    <div className="space-y-4">
                      <div className="text-center mb-4">
                        <div className="inline-flex p-3 rounded-full bg-primary/10 mb-2">
                          <UserIcon className="w-6 h-6 text-primary" />
                        </div>
                        <h2 className="text-lg font-semibold"> Choose your username </h2>
                        <p className="text-sm text-white/60"> This is how you'll be identified in the system </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                          id="username"
                          placeholder="johndoe"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="bg-white/5 border-white/10 focus:border-primary/50"
                        />
                      </div>
                      <Button
                        onClick={handleSignupStep3}
                        disabled={loading || username.length < 3}
                        className="w-full h-11 bg-primary hover:bg-primary/90"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Complete Registration
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-xs text-white/20">
          <p>
            By continuing, you agree to our
            <a href="/terms-of-service" className="mx-1 text-white/40 hover:text-primary underline">Terms of Service</a>
            and
            <a href="/privacy-policy" className="mx-1 text-white/40 hover:text-primary underline">Privacy Policy</a>.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
