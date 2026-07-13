
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription
} from "@/components/ui/dialog";
import {
  FileText,
  Video,
  Link2,
  Plus,
  Trash2,
  Loader2,
  Edit2,
  Tag,
  MessageSquare,
  Sparkles,
  Zap,
  Box
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PremiumLoader } from "@/components/ui/premium-loader";

interface ContentItem {
  id: string;
  contentType: string;
  name: string;
  content: string;
  intentTags: string[];
  channel: string;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
}

const CONTENT_TYPES = [
  { value: 'reply_template', label: 'Reply Template', icon: MessageSquare, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { value: 'cta', label: 'Call to Action', icon: Link2, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { value: 'video', label: 'Video Asset', icon: Video, color: 'text-pink-500', bg: 'bg-pink-500/10' },
  { value: 'script', label: 'Script', icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
];

const INTENT_TAGS = [
  'interested',
  'objection',
  'ready_to_buy',
  'needs_info',
  'cold',
  're_engage',
  'pricing_question',
  'booking_ready',
];

const CHANNELS = [
  { value: 'all', label: 'All Channels' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'email', label: 'Email' },
];

export default function ContentLibraryPage() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('reply_template');
  const [newContent, setNewContent] = useState({
    contentType: 'reply_template',
    name: '',
    content: '',
    channel: 'all',
    intentTags: [] as string[],
  });

  const { data: contentItems, isLoading } = useQuery<ContentItem[]>({
    queryKey: ['/api/automation/content'],
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newContent) => {
      return apiRequest('POST', '/api/automation/content', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/content'] });
      setShowCreateDialog(false);
      setNewContent({
        contentType: 'reply_template',
        name: '',
        content: '',
        channel: 'all',
        intentTags: [],
      });
      toast({ title: 'Content added', description: 'Your content has been saved to the library.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save content.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/automation/content/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/content'] });
      toast({ title: 'Content deleted' });
    },
  });

  const toggleTag = (tag: string) => {
    const current = newContent.intentTags;
    if (current.includes(tag)) {
      setNewContent({ ...newContent, intentTags: current.filter(t => t !== tag) });
    } else {
      setNewContent({ ...newContent, intentTags: [...current, tag] });
    }
  };

  const filteredContent = contentItems?.filter(item => item.contentType === activeTab) || [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2">
            Content Library <Box className="h-6 w-6 text-indigo-500" />
          </h1>
          <p className="text-muted-foreground mt-1 text-lg">
            Manage your AI's arsenal of templates, scripts, and media.
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button className="shadow-lg shadow-blue-500/20">
              <Plus className="h-4 w-4 mr-2" />
              Add Resource
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add to Library</DialogTitle>
              <DialogDescription>
                AI will pick the right content based on lead intent.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={newContent.contentType}
                    onValueChange={(value) => setNewContent({ ...newContent, contentType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="h-4 w-4 opacity-70" /> {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Channel</Label>
                  <Select
                    value={newContent.channel}
                    onValueChange={(value) => setNewContent({ ...newContent, channel: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((ch) => (
                        <SelectItem key={ch.value} value={ch.value}>
                          {ch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Internal Name</Label>
                <Input
                  placeholder="e.g., Pricing Objection Handler (High Ticket)"
                  value={newContent.name}
                  onChange={(e) => setNewContent({ ...newContent, name: e.target.value })}
                  className="bg-muted/30 border-border/50"
                />
              </div>

              <div className="space-y-2">
                <Label>Content / Value</Label>
                <Textarea
                  placeholder={newContent.contentType === 'cta' ? "https://your-link.com" : "Enter the message body or script here..."}
                  value={newContent.content}
                  onChange={(e) => setNewContent({ ...newContent, content: e.target.value })}
                  rows={5}
                  className="bg-muted/30 border-border/50 resize-none"
                />
              </div>

              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Tag className="h-3 w-3" /> Intent Triggers
                  <span className="text-xs font-normal text-muted-foreground">(When should AI use this?)</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {INTENT_TAGS.map((tag) => {
                    const isSelected = newContent.intentTags.includes(tag);
                    return (
                      <Badge
                        key={tag}
                        variant={isSelected ? 'default' : 'outline'}
                        className={`cursor-pointer transition-all ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                        onClick={() => toggleTag(tag)}
                      >
                        {isSelected && <Zap className="h-3 w-3 mr-1" />}
                        {tag}
                      </Badge>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border/50">
                <Button variant="ghost" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createMutation.mutate(newContent)}
                  disabled={!newContent.name || !newContent.content || createMutation.isPending}
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Resource
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1">
          <Card className="border-border/40 bg-card/50 backdrop-blur-sm sticky top-6">
            <CardContent className="p-3">
              <div className="flex flex-col space-y-1">
                {CONTENT_TYPES.map((type) => (
                  <Button
                    key={type.value}
                    variant={activeTab === type.value ? 'secondary' : 'ghost'}
                    className="justify-start h-10 px-3"
                    onClick={() => setActiveTab(type.value)}
                  >
                    <div className={`mr-3 p-1 rounded-md ${type.bg}`}>
                      <type.icon className={`h-4 w-4 ${type.color}`} />
                    </div>
                    {type.label}
                    {contentItems && (
                      <span className="ml-auto text-xs text-muted-foreground/60">
                        {contentItems.filter(i => i.contentType === type.value).length}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4 border-dashed border-border/60 bg-transparent hover:bg-muted/10 transition-colors cursor-pointer group" onClick={() => setShowCreateDialog(true)}>
            <CardContent className="p-6 text-center text-muted-foreground group-hover:text-foreground transition-colors">
              <Sparkles className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs font-medium">AI uses these assets to close deals automatically.</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Info */}
        <div className="lg:col-span-3">
          <Tabs value={activeTab} className="space-y-6">
            {CONTENT_TYPES.map((type) => (
              <TabsContent key={type.value} value={type.value} className="space-y-4 focus-visible:ring-0 mt-0">
                {isLoading ? (
                  <div className="py-20 flex justify-center"><PremiumLoader text={`Loading ${type.label}s...`} /></div>
                ) : !filteredContent.length ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border/40 rounded-xl bg-muted/5">
                    <div className={`p-4 rounded-full ${type.bg} mb-4`}>
                      <type.icon className={`h-8 w-8 ${type.color}`} />
                    </div>
                    <h3 className="text-lg font-semibold">No {type.label}s found</h3>
                    <p className="text-muted-foreground max-w-sm mt-1 mb-6">
                      Add templates or assets to help your AI handle leads more effectively.
                    </p>
                    <Button onClick={() => {
                      setNewContent({ ...newContent, contentType: type.value });
                      setShowCreateDialog(true);
                    }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create First {type.label}
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AnimatePresence>
                      {filteredContent.map((item) => (
                        <ContentCard
                          key={item.id}
                          item={item}
                          typeInfo={type}
                          onDelete={() => deleteMutation.mutate(item.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function ContentCard({
  item,
  typeInfo,
  onDelete,
}: {
  item: ContentItem;
  typeInfo: any;
  onDelete: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      <Card className="group hover:shadow-lg transition-all border-border/50 hover:border-primary/20 bg-card h-full flex flex-col">
        <CardHeader className="p-4 pb-2">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${typeInfo.bg}`}>
                <typeInfo.icon className={`h-4 w-4 ${typeInfo.color}`} />
              </div>
              <div>
                <CardTitle className="text-base leading-tight group-hover:text-primary transition-colors cursor-pointer">{item.name}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal uppercase tracking-wider text-muted-foreground">
                    {item.channel === 'all' ? 'Global' : item.channel}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2 flex-1 flex flex-col">
          <div className="bg-muted/30 rounded-lg p-3 text-sm text-foreground/80 font-mono text-xs line-clamp-4 flex-1 mb-4 border border-border/50">
            {item.content}
          </div>

          <div className="flex items-center justify-between mt-auto">
            <div className="flex gap-1 flex-wrap">
              {item.intentTags?.slice(0, 2).map(tag => (
                <Badge key={tag} variant="outline" className="text-[10px] bg-background">#{tag}</Badge>
              ))}
              {item.intentTags?.length > 2 && (
                <Badge variant="outline" className="text-[10px] bg-background">+{item.intentTags.length - 2}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
