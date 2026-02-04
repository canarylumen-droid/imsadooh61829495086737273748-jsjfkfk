import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Shield, Lock, Eye, EyeOff, Mail, Loader2, ArrowRight, User as UserIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useUser } from "@/hooks/use-user";
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
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { data: user } = useUser();
  const { toast } = useToast();

  // Signup flow: 1 = Email+Password, 2 = OTP/Skip, 3 = Username, 4 = Success
  const [signupStep, setSignupStep] = useState(1);
  const [isLogin, setIsLogin] = useState(false);

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
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

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
        console.log('State check skipped');
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
        const { step, message, username: savedUsername } = data.restoreState;

        toast({
          title: "Welcome Back!",
          description: message || "Continue where you left off",
        });

        setLoading(false);

        // Skip onboarding - go straight to dashboard
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 500);
        return;
      }

      toast({
        title: "Welcome back!",
        description: "Redirecting to dashboard...",
      });

      // Direct redirect after successful login
      setTimeout(() => {
        window.location.href = '/dashboard';
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

  // SIGNUP STEP 1: Email + Password
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
      const response = await fetch('/api/user/auth/signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, otp }),
        credentials: 'include',
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        toast({
          title: "Account Created",
          description: "Welcome to Audnix AI!",
        });

        // Final login to establish session
        window.location.href = '/dashboard';
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
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0b] p-4 font-sans text-white overflow-hidden relative">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background pointer-events-none" />
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <div className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-4 border border-primary/20"
          >
            <Shield className="w-8 h-8 text-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]" />
          </motion.div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-2"> Audnix AI </h1>
          <p className="text-muted-foreground">
            {isLogin ? "Sign in to your account" : signupStep === 2 ? "Verify your email" : signupStep === 3 ? "Complete your profile" : "Create your account"}
          </p>
        </div>

        <Card className="bg-white/5 border-white/10 backdrop-blur-xl shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />

          <CardHeader className="pb-4">
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
          </CardHeader>

          <CardContent>
            <AnimatePresence mode="wait">
              {isLogin ? (
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
                        className="pl-10 bg-white/5 border-white/10 focus:border-primary/50"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="password">Password</Label>
                      <button type="button" className="text-xs text-primary hover:underline">Forgot password?</button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="password"
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
                  </div>

                  <Button
                    onClick={handleLogin}
                    disabled={loading}
                    className="w-full h-11 bg-primary hover:bg-primary/90"
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
                              <span style={{ color: getPasswordStrengthColor().replace('bg-', '') }}>{getPasswordStrengthText()}</span>
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
                        onClick={handleSignupStep1}
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
            <button className="mx-1 text-white/40 hover:text-primary underline">Terms of Service</button>
            and
            <button className="mx-1 text-white/40 hover:text-primary underline">Privacy Policy</button>.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
