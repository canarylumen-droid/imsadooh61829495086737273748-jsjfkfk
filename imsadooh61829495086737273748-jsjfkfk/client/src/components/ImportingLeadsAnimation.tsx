import { motion, AnimatePresence } from "framer-motion";
import { Mail, Loader2, Sparkles, CheckCircle2, Brain, Filter, Zap, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useEffect, useCallback } from "react";
import { Progress } from "@/components/ui/progress";

interface ImportingLeadsAnimationProps {
  channel: "email" | "crm";
  onComplete?: () => void;
  isImporting: boolean;
  planLimit?: number;
  currentLeads?: number;
}

type ImportStage = "connecting" | "scanning" | "filtering" | "importing" | "complete";

const channelConfig = {
  email: {
    icon: Mail,
    name: "Business Email",
    color: "from-blue-500 to-cyan-600",
    bgColor: "bg-gradient-to-r from-blue-500/10 to-cyan-600/10",
    borderColor: "border-blue-500/30",
    textColor: "text-blue-500",
    scanText: "Scanning email inbox...",
    filterText: "Matching lead data...",
    importText: "Importing verified leads...",
  },
  crm: {
    icon: Users,
    name: "CRM Hub",
    color: "from-purple-500 to-indigo-600",
    bgColor: "bg-gradient-to-r from-purple-500/10 to-indigo-600/10",
    borderColor: "border-purple-500/30",
    textColor: "text-purple-500",
    scanText: "Syncing with ecosystem...",
    filterText: "Mapping columns...",
    importText: "Importing ecosystem leads...",
  },
};

const stageIcons = {
  connecting: Zap,
  scanning: Users,
  filtering: Brain,
  importing: Filter,
  complete: CheckCircle2,
};

export function ImportingLeadsAnimation({
  channel,
  onComplete,
  isImporting,
  planLimit = 500,
  currentLeads = 0,
}: ImportingLeadsAnimationProps) {
  const config = channelConfig[channel];
  const ChannelIcon = config.icon;
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<ImportStage>("connecting");
  const [scannedCount, setScannedCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [aiMessages, setAiMessages] = useState<string[]>([]);

  const aiFilteringMessages = [
    "Parsing communication threads...",
    "Detecting inquiry intent...",
    "Filtering spam and promotions...",
    "Analyzing response patterns...",
    "Identifying decision makers...",
    "Scoring ecosystem engagement...",
  ];

  const updateAiMessage = useCallback(() => {
    const randomMessage = aiFilteringMessages[Math.floor(Math.random() * aiFilteringMessages.length)];
    setAiMessages(prev => [...prev.slice(-2), randomMessage]);
  }, []);

  useEffect(() => {
    if (!isImporting) return;

    let scanInterval: NodeJS.Timeout;
    let progressInterval: NodeJS.Timeout;
    let aiMessageInterval: NodeJS.Timeout;

    const startSequence = async () => {
      setStage("connecting");
      await new Promise(r => setTimeout(r, 800));

      setStage("scanning");
      scanInterval = setInterval(() => {
        setScannedCount(prev => {
          const increment = Math.floor(Math.random() * 10) + 3;
          return Math.min(prev + increment, 500);
        });
      }, 200);

      progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            clearInterval(progressInterval);
            clearInterval(scanInterval);
            clearInterval(aiMessageInterval);
            return 100;
          }

          if (prev >= 25 && stage === "scanning") {
            setStage("filtering");
            aiMessageInterval = setInterval(updateAiMessage, 1500);
          }
          if (prev >= 55 && stage === "filtering") {
            setStage("importing");
            setFilteredCount(Math.floor(scannedCount * 0.3));
          }
          if (prev >= 95) {
            setStage("complete");
            setImportedCount(Math.floor(scannedCount * 0.25));
            setTimeout(() => {
              onComplete?.();
            }, 2500);
          }

          return prev + 2.2;
        });
      }, 150);
    };

    startSequence();

    return () => {
      clearInterval(scanInterval);
      clearInterval(progressInterval);
      clearInterval(aiMessageInterval);
    };
  }, [isImporting, channel, onComplete, updateAiMessage]);

  useEffect(() => {
    if (stage === "filtering") {
      setFilteredCount(prev => Math.min(prev + 1, Math.floor(scannedCount * 0.4)));
    }
    if (stage === "importing") {
      setImportedCount(prev => Math.min(prev + 1, Math.floor(scannedCount * 0.3)));
    }
  }, [progress, stage, scannedCount]);

  if (!isImporting) return null;

  const StageIcon = stageIcons[stage];
  const remainingSlots = Math.max(0, planLimit - currentLeads);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
    >
      <Card className={`w-full max-w-lg mx-4 border-2 ${config.borderColor} shadow-2xl bg-background/95`}>
        <CardContent className="p-8">
          <div className="flex flex-col items-center text-center space-y-6">
            {stage !== "complete" ? (
              <>
                <div className="relative">
                  <motion.div
                    className={`w-24 h-24 rounded-full ${config.bgColor} flex items-center justify-center relative overflow-hidden`}
                    animate={{
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <ChannelIcon className={`h-12 w-12 ${config.textColor}`} />

                    <motion.div
                      className="absolute inset-0"
                      style={{
                        background: "radial-gradient(circle, rgba(59,130,246,0.3) 0%, transparent 70%)",
                      }}
                      animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </motion.div>

                  <motion.div
                    className="absolute -right-2 -bottom-2 bg-background rounded-full p-2 shadow-lg border"
                    animate={{ rotate: stage === "filtering" ? 360 : 0 }}
                    transition={{ duration: 2, repeat: stage === "filtering" ? Infinity : 0, ease: "linear" }}
                  >
                    <StageIcon className={`h-5 w-5 ${stage === "filtering" ? "text-purple-500" : config.textColor}`} />
                  </motion.div>
                </div>

                <div className="space-y-2 w-full">
                  <h3 className="text-xl font-bold">
                    {stage === "connecting" && `Connecting to ${config.name}...`}
                    {stage === "scanning" && config.scanText}
                    {stage === "filtering" && config.filterText}
                    {stage === "importing" && config.importText}
                  </h3>

                  <AnimatePresence mode="wait">
                    {stage === "filtering" && aiMessages.length > 0 && (
                      <motion.p
                        key={aiMessages[aiMessages.length - 1]}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="text-sm text-purple-400 flex items-center justify-center gap-2"
                      >
                        <Brain className="h-4 w-4 animate-pulse" />
                        {aiMessages[aiMessages.length - 1]}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <div className="grid grid-cols-3 gap-4 w-full text-center">
                  <motion.div
                    className="bg-muted/50 rounded-lg p-3"
                    animate={{ scale: stage === "scanning" ? [1, 1.02, 1] : 1 }}
                    transition={{ duration: 0.5, repeat: stage === "scanning" ? Infinity : 0 }}
                  >
                    <div className={`text-2xl font-bold ${config.textColor}`}>
                      {scannedCount}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Leads Scanned
                    </div>
                  </motion.div>

                  <motion.div
                    className="bg-muted/50 rounded-lg p-3"
                    animate={{ scale: stage === "filtering" ? [1, 1.02, 1] : 1 }}
                    transition={{ duration: 0.5, repeat: stage === "filtering" ? Infinity : 0 }}
                  >
                    <div className="text-2xl font-bold text-purple-500">
                      {filteredCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Matched</div>
                  </motion.div>

                  <motion.div
                    className="bg-muted/50 rounded-lg p-3"
                    animate={{ scale: stage === "importing" ? [1, 1.02, 1] : 1 }}
                    transition={{ duration: 0.5, repeat: stage === "importing" ? Infinity : 0 }}
                  >
                    <div className="text-2xl font-bold text-emerald-500">
                      {importedCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Leads Imported</div>
                  </motion.div>
                </div>

                <div className="w-full space-y-2">
                  <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full bg-gradient-to-r ${config.color} relative`}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(progress, 100)}%` }}
                      transition={{ duration: 0.3 }}
                    >
                      <motion.div
                        className="absolute inset-0 bg-white/20"
                        animate={{ x: ["-100%", "200%"] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      />
                    </motion.div>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{Math.min(Math.round(progress), 100)}% complete</span>
                    <span>{currentLeads + importedCount} / {planLimit} leads</span>
                  </div>
                </div>

                {remainingSlots < 100 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-amber-500 bg-amber-500/10 px-3 py-2 rounded-full"
                  >
                    Only {remainingSlots} lead slots remaining on your plan
                  </motion.div>
                )}

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Importing — please don't close this window</span>
                </div>
              </>
            ) : (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15 }}
                className="space-y-6 w-full"
              >
                <motion.div
                  className="w-24 h-24 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1, rotate: 360 }}
                  transition={{ type: "spring", damping: 10, delay: 0.2 }}
                >
                  <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                </motion.div>

                <div className="space-y-2">
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-emerald-500 to-green-600 bg-clip-text text-transparent">
                    Import Complete!
                  </h3>
                  <p className="text-lg font-medium">
                    {importedCount} leads imported
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="text-3xl font-bold text-emerald-500">{importedCount}</div>
                    <div className="text-sm text-muted-foreground">New Leads</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="text-3xl font-bold text-purple-500">{scannedCount - filteredCount}</div>
                    <div className="text-sm text-muted-foreground">Filtered Out</div>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  {scannedCount - filteredCount} rows were duplicates or empty
                </p>

                <motion.div
                  className="flex items-center justify-center gap-2 text-primary"
                  animate={{
                    y: [0, -5, 0],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <Sparkles className="h-5 w-5" />
                  <span className="text-sm font-medium">Your leads are ready for outreach</span>
                </motion.div>
              </motion.div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
