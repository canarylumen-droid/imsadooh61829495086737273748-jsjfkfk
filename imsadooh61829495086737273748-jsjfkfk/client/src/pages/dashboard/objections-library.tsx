import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Search,
  Copy,
  Check,
  Filter,
  MessageSquare,
  Instagram,
  Mail,
  Clock,
  DollarSign,
  Shield,
  Users,
  Target,
  Swords,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ShieldAlert,
  Plus,
  Trash2,
  Edit2,
  Lightbulb,
} from "lucide-react";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface Objection {
  id: string;
  name: string;
  content: string;
  category: string;
  intentTags: string[];
  objectionTags: string[];
  channelRestriction: string;
  usageCount: number;
  successRate: number | null;
}

interface ObjectionsResponse {
  objections: Objection[];
  categories: { id: string; name: string; count: number }[];
  total: number;
}

interface CustomObjection {
  id?: string;
  objection: string;
  response: string;
  category: string;
}

const categoryIcons: Record<string, any> = {
  timing: Clock,
  price: DollarSign,
  trust: Shield,
  authority: Users,
  fit: Target,
  competitor: Swords,
  decision: CheckCircle2,
};

const CATEGORY_STYLES: Record<string, string> = {
  price: "border-primary/20 bg-primary/5 text-primary",
  fit: "border-purple-500/20 bg-purple-500/5 text-purple-500",
  timing: "border-primary/20 bg-primary/5 text-primary",
  generic: "border-border/10 bg-muted/50 text-muted-foreground",
};

// Helper function for copying text
function copyToClipboard(text: string, type: string, toast: any) {
  navigator.clipboard.writeText(text)
    .then(() => {
      toast({ description: `${type} copied to clipboard!` });
    })
    .catch(err => {
      toast({ description: `Failed to copy ${type}`, variant: "destructive" });
    });
}

function ObjectionCard({ objection, index }: {
  objection: Objection;
  index: number;
}) {
  const { toast } = useToast();

  return (
    <motion.div
      key={objection.id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 100, damping: 10 }}
    >
      <Card className={`overflow-hidden border group transition-all duration-500 hover:scale-[1.02] cursor-pointer rounded-2xl ${CATEGORY_STYLES[objection.category] || CATEGORY_STYLES.generic}`}>
        <CardHeader className="p-8 pb-4">
          <div className="flex items-center justify-between mb-4">
            <Badge variant="outline" className="font-semibold uppercase tracking-wider text-[10px] bg-muted/20 border-border/10">
              {objection.category.toUpperCase()} PATTERN
            </Badge>
            <ShieldAlert className="h-4 w-4 text-muted-foreground/30" />
          </div>
          <CardTitle className="text-xl font-bold text-foreground uppercase tracking-tight leading-none group-hover:text-primary transition-colors">{objection.name}</CardTitle>
        </CardHeader>
        <CardContent className="p-8 pt-0 space-y-4">
          <div className="p-6 rounded-2xl bg-card border border-border/40">
            <p className="text-sm font-medium text-foreground/80 leading-relaxed tracking-tight">{objection.content}</p>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); copyToClipboard(objection.content, 'Intelligent Response', toast); }}
                className="p-2.5 rounded-xl bg-muted/50 hover:bg-primary/20 transition-all text-muted-foreground hover:text-primary active:scale-90"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <Button variant="ghost" size="sm" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-primary h-auto p-0">
              Evolution Logic <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function ObjectionsLibraryPage() {
  const queryClient = useQueryClient();
  const [activeMainTab, setActiveMainTab] = useState<"standard" | "custom">("standard");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const { toast } = useToast();

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formObjection, setFormObjection] = useState("");
  const [formResponse, setFormResponse] = useState("");
  const [formCategory, setFormCategory] = useState("general");

  // Standard playbook queries
  const { data, isLoading } = useQuery<ObjectionsResponse>({
    queryKey: [
      "/api/objections",
      {
        category: selectedCategory !== "all" ? selectedCategory : undefined,
        channel: selectedChannel !== "all" ? selectedChannel : undefined,
        search: searchQuery || undefined,
      },
    ],
  });

  // Custom objections queries
  const { data: customTrainingResponse, isLoading: isLoadingCustom } = useQuery<CustomObjection[]>({
    queryKey: ["/api/custom-training/objections"],
  });
  const customObjections = Array.isArray(customTrainingResponse)
    ? customTrainingResponse
    : [];

  const updateCustomObjections = useMutation({
    mutationFn: async (newObjections: CustomObjection[]) => {
      const response = await apiRequest("POST", "/api/custom-training/objections", {
        objections: newObjections,
      });
      return response.json();
    },
    onSuccess: () => {
      // Invalidate the query so the frontend refetches fresh data with the correct
      // { objections: [...] } shape from the API — avoids stale/mismatched cache.
      queryClient.invalidateQueries({ queryKey: ["/api/custom-training/objections"] });
      toast({
        title: "Objection rules saved",
        description: "Your custom objection handler has been successfully trained into the AI.",
      });
      setIsDialogOpen(false);
      setEditingIndex(null);
      setFormObjection("");
      setFormResponse("");
      setFormCategory("general");
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save",
        description: err.message || "An error occurred while saving the objection.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = (index: number) => {
    const item = customObjections[index];
    setEditingIndex(index);
    setFormObjection(item.objection);
    setFormResponse(item.response);
    setFormCategory(item.category);
    setIsDialogOpen(true);
  };

  const handleDelete = (index: number) => {
    if (confirm("Are you sure you want to delete this custom objection rule?")) {
      const updated = customObjections.filter((_, i) => i !== index);
      updateCustomObjections.mutate(updated);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formObjection.trim() || !formResponse.trim()) {
      toast({
        title: "Validation error",
        description: "Please fill in all fields.",
        variant: "destructive",
      });
      return;
    }

    const newItem: CustomObjection = {
      objection: formObjection.trim(),
      response: formResponse.trim(),
      category: formCategory,
    };

    let updated: CustomObjection[];
    if (editingIndex !== null) {
      updated = [...customObjections];
      updated[editingIndex] = newItem;
    } else {
      updated = [...customObjections, newItem];
    }

    updateCustomObjections.mutate(updated);
  };

  const filteredObjections = useMemo(() => {
    if (!data?.objections) return [];
    let filtered = data.objections;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (obj) =>
          obj.name.toLowerCase().includes(query) ||
          obj.content.toLowerCase().includes(query) ||
          obj.objectionTags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [data?.objections, searchQuery]);

  const categories = [
    { id: "all", name: "All", count: data?.total || 0 },
    ...(data?.categories || []),
  ];

  return (
    <PageWrapper className="space-y-8">
      {/* Header with outer Main Tabs */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 border-b border-border/10 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-primary" />
            Objection Library & AI Training
          </h1>
          <p className="text-muted-foreground mt-1">
            Browse the global proven playbook or inject custom training rules for your specific business.
          </p>
        </div>
        <Tabs value={activeMainTab} onValueChange={(val: any) => setActiveMainTab(val)}>
          <TabsList className="bg-muted/40 border border-border/40 p-1 rounded-xl">
            <TabsTrigger
              value="standard"
              className="rounded-lg data-[state=active]:bg-background font-bold text-xs uppercase tracking-wider px-4 py-2"
            >
              Proven Playbook
            </TabsTrigger>
            <TabsTrigger
              value="custom"
              className="rounded-lg data-[state=active]:bg-background font-bold text-xs uppercase tracking-wider px-4 py-2"
            >
              Custom AI Training
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <AnimatePresence mode="wait">
        {activeMainTab === "standard" ? (
          <motion.div
            key="standard-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-8"
          >
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative group flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <Input
                  placeholder="Search response patterns..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 bg-muted/40 border-border/40 rounded-xl h-12 focus:border-primary/50 transition-all font-semibold tracking-tight"
                />
              </div>
              <div className="flex gap-2">
                <Tabs value={selectedChannel} onValueChange={setSelectedChannel}>
                  <TabsList className="bg-muted/40 border border-border/40">
                    <TabsTrigger value="all" className="data-[state=active]:bg-background">
                      All
                    </TabsTrigger>
                    <TabsTrigger value="email" className="data-[state=active]:bg-background">
                      <Mail className="w-4 h-4 mr-1" />
                      Email
                    </TabsTrigger>
                    <TabsTrigger value="instagram" className="data-[state=active]:bg-background">
                      <Instagram className="w-4 h-4 mr-1" />
                      Instagram
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const Icon = categoryIcons[cat.id] || Filter;
                return (
                  <Button
                    key={cat.id}
                    variant={selectedCategory === cat.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={
                      selectedCategory === cat.id
                        ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30"
                        : "bg-muted/50 border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }
                  >
                    <Icon className="w-3.5 h-3.5 mr-1.5" />
                    {cat.name}
                    <span className="ml-1.5 text-xs opacity-60">({cat.count})</span>
                  </Button>
                );
              })}
            </div>

            {isLoading ? (
              <ResponsiveGrid>
                {[...Array(9)].map((_, i) => (
                  <Skeleton key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
                ))}
              </ResponsiveGrid>
            ) : filteredObjections.length === 0 ? (
              <Card className="bg-muted/40 border-border/40">
                <CardContent className="py-12 text-center">
                  <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground/80">No objections found</h3>
                  <p className="text-muted-foreground mt-1">Try a different search or category</p>
                </CardContent>
              </Card>
            ) : (
              <ResponsiveGrid>
                {filteredObjections.map((objection, index) => (
                  <ObjectionCard key={objection.id} objection={objection} index={index} />
                ))}
              </ResponsiveGrid>
            )}

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-12 p-8 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-purple-500/5 border border-primary/20 relative overflow-hidden group transition-all duration-500"
            >
              <div className="absolute inset-0 bg-primary/5 blur-[120px] rounded-full" />
              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="text-center md:text-left space-y-2">
                  <h2 className="text-2xl font-bold text-white tracking-tight">
                    Custom Sales Logic Required?
                  </h2>
                  <p className="text-white/60 text-sm max-w-md leading-relaxed">
                    Train your personal objection patterns into the core for proven close rates. Automated optimization active.
                  </p>
                </div>
                <Button
                  onClick={() => setActiveMainTab("custom")}
                  className="h-11 px-6 rounded-xl bg-white text-black font-bold uppercase tracking-wider text-xs hover:bg-white/90 active:scale-98 transition-all shadow-lg shadow-white/5 shrink-0"
                >
                  Configure Trainer
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="custom-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            {/* Custom Rules Top Control Bar */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">Custom AI Objection Handlers</h2>
                <p className="text-xs text-muted-foreground">
                  Define exact scenarios and the response style or instruction the AI must execute.
                </p>
              </div>

              {/* Dialog trigger for adding new rule */}
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    onClick={() => {
                      setEditingIndex(null);
                      setFormObjection("");
                      setFormResponse("");
                      setFormCategory("general");
                    }}
                    className="bg-primary hover:bg-primary/95 text-black font-bold uppercase tracking-wider text-xs px-4 py-2.5 rounded-xl flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add custom rule
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md bg-background border border-border/40 p-6 rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-foreground">
                      {editingIndex !== null ? "Edit Custom Objection Rule" : "Add Custom Objection Rule"}
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSave} className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="objection-pattern" className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Prospect Objection Pattern
                      </Label>
                      <Input
                        id="objection-pattern"
                        placeholder='e.g., "Too expensive", "We are using a competitor", "Check back next quarter"'
                        value={formObjection}
                        onChange={(e) => setFormObjection(e.target.value)}
                        className="bg-muted/40 border-border/40 rounded-xl"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category-select" className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Category
                      </Label>
                      <Select value={formCategory} onValueChange={setFormCategory}>
                        <SelectTrigger className="bg-muted/40 border-border/40 rounded-xl">
                          <SelectValue placeholder="Select Category" />
                        </SelectTrigger>
                        <SelectContent className="bg-background border border-border/40">
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="price">Price / Cost</SelectItem>
                          <SelectItem value="timing">Timing / Delay</SelectItem>
                          <SelectItem value="trust">Trust / Authority</SelectItem>
                          <SelectItem value="fit">Product Fit</SelectItem>
                          <SelectItem value="competitor">Competitor Comparison</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="response-instruction" className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Preferred Response or Handling Instruction
                      </Label>
                      <Textarea
                        id="response-instruction"
                        rows={4}
                        placeholder='e.g., "Offer a 20% early adopter discount if they close this week. Alternatively, propose our monthly subscription option."'
                        value={formResponse}
                        onChange={(e) => setFormResponse(e.target.value)}
                        className="bg-muted/40 border-border/40 rounded-xl resize-none"
                      />
                    </div>

                    <DialogFooter className="pt-4 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsDialogOpen(false)}
                        className="rounded-xl border-border/40 font-semibold"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={updateCustomObjections.isPending}
                        className="bg-primary hover:bg-primary/95 text-black font-bold uppercase tracking-wider text-xs rounded-xl"
                      >
                        {updateCustomObjections.isPending ? "Saving..." : "Train AI Model"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {isLoadingCustom ? (
              <ResponsiveGrid>
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-40 bg-muted animate-pulse rounded-2xl" />
                ))}
              </ResponsiveGrid>
            ) : customObjections.length === 0 ? (
              <Card className="bg-muted/20 border-dashed border-border/40 py-16 text-center">
                <CardContent className="space-y-4">
                  <Lightbulb className="w-12 h-12 text-primary/40 mx-auto" />
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-foreground">No Custom Objection Rules Defined</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      AI relies on standard rules. Create your first custom objection handling instruction above to fine-tune responses!
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <ResponsiveGrid>
                {customObjections.map((rule, idx) => {
                  const Icon = categoryIcons[rule.category] || Lightbulb;
                  return (
                    <Card
                      key={idx}
                      className="overflow-hidden border border-border/40 rounded-2xl hover:border-primary/30 transition-all group"
                    >
                      <CardHeader className="p-6 pb-2 flex flex-row items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-primary" />
                          <Badge variant="outline" className="font-semibold uppercase tracking-wider text-[10px] bg-muted/20 border-border/10">
                            {rule.category.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(idx)}
                            className="h-8 w-8 text-muted-foreground hover:text-primary rounded-lg"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(idx)}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6 pt-2 space-y-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Prospect says:</p>
                          <p className="text-sm font-bold text-foreground mt-0.5">"{rule.objection}"</p>
                        </div>
                        <div className="p-4 rounded-xl bg-muted/30 border border-border/20">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-primary/70">AI Instruction:</p>
                          <p className="text-xs text-foreground/80 mt-1 leading-relaxed">{rule.response}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </ResponsiveGrid>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
