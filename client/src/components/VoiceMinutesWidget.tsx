import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mic, Lock, Zap, TrendingUp, AlertTriangle, Sparkles } from "lucide-react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useCanAccessVoiceNotes } from "@/hooks/use-access-gate";

interface VoiceBalanceData {
  balance: number;
  total: number;
  used: number;
  percentage: number;
  locked: boolean;
}

export function VoiceMinutesWidget() {
  const [_, navigate] = useLocation();
  const { canAccess: canAccessVoiceNotes } = useCanAccessVoiceNotes();
  const { data: voiceBalance, isLoading } = useQuery<VoiceBalanceData>({
    queryKey: ["/api/voice/balance"],

  });

  const balance = voiceBalance?.balance || 0;
  const total = voiceBalance?.total || 0;
  const used = voiceBalance?.used || 0;
  const percentage = voiceBalance?.percentage || 0;
  const isLocked = voiceBalance?.locked || false;
  const minutesRemaining = total - used;
  const minutesUsed = used;
  const totalMinutes = total;

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="p-4 sm:p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-8 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!canAccessVoiceNotes) {
    return (
      <Card className="w-full border-primary/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
          <div className="text-center p-4 space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">Voice Minutes</p>
              <p className="text-xs text-muted-foreground mb-3">Available on Starter+</p>
              <Link href="/dashboard/pricing">
                <Button size="sm" className="gap-1.5 text-xs">
                  <Sparkles className="w-3 h-3" />
                  Upgrade
                </Button>
              </Link>
            </div>
          </div>
        </div>
        <CardHeader className="pb-3 opacity-30">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-muted-foreground" />
            <span>Voice Minutes</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="opacity-30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Minutes Used</p>
              <p className="text-2xl font-bold">0</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total Available</p>
              <p className="text-2xl font-bold">0</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-primary/20 hover:border-primary/50 transition-all duration-300">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Mic className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0" />
            <span>Voice Minutes</span>
          </CardTitle>
          {isLocked && (
            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
              <Lock className="h-3 w-3" />
              <span className="text-xs">Out of Minutes</span>
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {minutesRemaining < 50 && minutesRemaining > 0 && !isLocked && (
          <Alert className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
              Low balance: {minutesRemaining} minutes left
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-muted-foreground">Minutes Used</p>
            <p className="text-2xl font-bold">{minutesUsed.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total Available</p>
            <p className="text-2xl font-bold">{totalMinutes.toLocaleString()}</p>
          </div>
        </div>

        {isLocked ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 sm:p-4 rounded-lg bg-red-500/10 border border-red-500/20"
          >
            <div className="flex items-start gap-2 sm:gap-3">
              <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-red-500 mb-1 text-sm sm:text-base">
                  🔒 Voice minutes depleted
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3">
                  Top up instantly to send AI voice notes
                </p>
                <Link href="/dashboard/pricing#topups">
                  <Button size="sm" className="w-full bg-red-500 hover:bg-red-600 text-xs sm:text-sm">
                    <Zap className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    Buy More Minutes
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs sm:text-sm text-emerald-500">
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="truncate">{Math.floor(balance)} minutes left</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs sm:text-sm"
              onClick={() => navigate("/dashboard/pricing#topups")}
            >
              <Zap className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Top Up Now
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
