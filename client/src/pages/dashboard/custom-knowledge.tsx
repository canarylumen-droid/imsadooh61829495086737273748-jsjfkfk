import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageWrapper } from "@/components/ui/page-wrapper";
import {
  Sparkles,
  BookOpen,
  Volume2,
  Tag,
  HelpCircle,
  Plus,
  Trash2,
  Save,
  Building,
  AlertCircle
} from "lucide-react";

interface FAQ {
  question: string;
  answer: string;
}

interface CustomKnowledge {
  businessName?: string;
  brandVoice?: string;
  coreOffer?: string;
  customInstructions?: string;
  faqs?: FAQ[];
}

export default function CustomKnowledgePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query custom knowledge from S3
  const { data: knowledge, isLoading } = useQuery<CustomKnowledge>({
    queryKey: ["/api/custom-training/knowledge"],
  });

  // Local form state
  const [businessName, setBusinessName] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [coreOffer, setCoreOffer] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [faqs, setFaqs] = useState<FAQ[]>([]);

  // Sync query data to local state once loaded
  useEffect(() => {
    if (knowledge) {
      setBusinessName(knowledge.businessName || "");
      setBrandVoice(knowledge.brandVoice || "");
      setCoreOffer(knowledge.coreOffer || "");
      setCustomInstructions(knowledge.customInstructions || "");
      setFaqs(knowledge.faqs || []);
    }
  }, [knowledge]);

  // Mutation to save back to S3
  const saveMutation = useMutation({
    mutationFn: async (updatedData: CustomKnowledge) => {
      const response = await apiRequest("POST", "/api/custom-training/knowledge", updatedData);
      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate the query so the frontend refetches fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/custom-training/knowledge"] });
      // Update local state with the saved data
      if (data) {
        setBusinessName(data.businessName || "");
        setBrandVoice(data.brandVoice || "");
        setCoreOffer(data.coreOffer || "");
        setCustomInstructions(data.customInstructions || "");
        setFaqs(data.faqs || []);
      }
      toast({
        title: "Knowledge base saved",
        description: "Your brand and business context have been successfully trained into the AI.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save",
        description: err.message || "An error occurred while saving custom knowledge.",
        variant: "destructive",
      });
    }
  });

  const handleAddFaq = () => {
    setFaqs([...faqs, { question: "", answer: "" }]);
  };

  const handleFaqChange = (index: number, field: keyof FAQ, value: string) => {
    const updated = [...faqs];
    updated[index][field] = value;
    setFaqs(updated);
  };

  const handleRemoveFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      businessName,
      brandVoice,
      coreOffer,
      customInstructions,
      faqs: faqs.filter(f => f.question.trim() && f.answer.trim())
    });
  };

  return (
    <PageWrapper className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border/10 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-primary" />
            Custom Knowledge Base
          </h1>
          <p className="text-muted-foreground mt-1">
            Train the AI on your unique business context, core offers, tone of voice, and frequently asked questions.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Card className="h-40 bg-muted animate-pulse rounded-2xl" />
          <Card className="h-60 bg-muted animate-pulse rounded-2xl" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-8">
          {/* Core Business Metadata Card */}
          <Card className="border border-border/40 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-md">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Building className="w-5 h-5 text-primary" />
                Business & Offer Details
              </CardTitle>
              <CardDescription>
                Define who you are and what the AI is pitching. This information is dynamically injected into the lead response context.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-0 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="business-name" className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Business / Brand Name
                </Label>
                <Input
                  id="business-name"
                  placeholder="e.g., Acme Consulting, SaaSify Labs"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="bg-muted/40 border-border/40 rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="core-offer" className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Core Offer Details
                </Label>
                <Textarea
                  id="core-offer"
                  rows={4}
                  placeholder='e.g., "A 12-week high-ticket growth program for agency owners. Priced at $5,000 or 3 payments of $1,800. Includes weekly 1:1 calls, a customized funnel build, and lifetime community access."'
                  value={coreOffer}
                  onChange={(e) => setCoreOffer(e.target.value)}
                  className="bg-muted/40 border-border/40 rounded-xl resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* Tone & Personality Card */}
          <Card className="border border-border/40 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-md">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Volume2 className="w-5 h-5 text-primary" />
                Brand Voice & Personality Guidelines
              </CardTitle>
              <CardDescription>
                Control how the AI sounds. Keep it matching your personal style.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-0 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="brand-voice" className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Brand Voice / Style Instructions
                </Label>
                <Textarea
                  id="brand-voice"
                  rows={4}
                  placeholder='e.g., "Direct, professional yet friendly. Do not use corporate jargon. Avoid exclamation marks. Sound like an advisor helping them win, not a salesman."'
                  value={brandVoice}
                  onChange={(e) => setBrandVoice(e.target.value)}
                  className="bg-muted/40 border-border/40 rounded-xl resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-instructions" className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  Custom AI Guidelines
                  <span title="Global rules applied to every reply generated by the system">
                    <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                </Label>
                <Textarea
                  id="custom-instructions"
                  rows={4}
                  placeholder='e.g., "Never book calls on Fridays. If the lead is in Europe, always propose GMT timezone. Do not send links in the first response under any circumstances."'
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  className="bg-muted/40 border-border/40 rounded-xl resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* FAQs Manager Card */}
          <Card className="border border-border/40 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-md">
            <CardHeader className="p-8 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <HelpCircle className="w-5 h-5 text-primary" />
                  Frequently Asked Questions (FAQs)
                </CardTitle>
                <CardDescription>
                  Provide exact answers to common questions about your service, pricing, or results.
                </CardDescription>
              </div>
              <Button
                type="button"
                onClick={handleAddFaq}
                className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/30 font-bold uppercase tracking-wider text-xs px-4 py-2 rounded-xl flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add FAQ
              </Button>
            </CardHeader>
            <CardContent className="p-8 pt-0 space-y-6">
              {faqs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-xs italic">
                  No custom FAQs defined yet. Click "Add FAQ" to train specific Q&A patterns.
                </div>
              ) : (
                <div className="space-y-6">
                  {faqs.map((faq, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-6 rounded-2xl bg-muted/20 border border-border/30 relative space-y-4 group"
                    >
                      <button
                        type="button"
                        onClick={() => handleRemoveFaq(idx)}
                        className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <div className="space-y-2 pr-8">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Question
                        </Label>
                        <Input
                          placeholder="e.g., Do you offer refunds?"
                          value={faq.question}
                          onChange={(e) => handleFaqChange(idx, "question", e.target.value)}
                          className="bg-card border-border/40 rounded-xl"
                        />
                      </div>

                      <div className="space-y-2 pr-8">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Answer / AI Response Style
                        </Label>
                        <Textarea
                          placeholder="e.g., Yes, we offer a 14-day action-based refund guarantee if you implement everything and do not see results."
                          value={faq.answer}
                          onChange={(e) => handleFaqChange(idx, "answer", e.target.value)}
                          className="bg-card border-border/40 rounded-xl resize-none"
                          rows={3}
                        />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Bar */}
          <div className="flex items-center justify-end gap-4 border-t border-border/10 pt-6">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="bg-primary hover:bg-primary/95 text-black font-bold uppercase tracking-wider text-xs px-6 py-3 rounded-xl flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? "Saving..." : "Train Knowledge Base"}
            </Button>
          </div>
        </form>
      )}
    </PageWrapper>
  );
}
