import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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
  Brain,
  Settings2,
  Zap,
  Clock,
  MessageSquare,
  Calendar,
  Mail,
  Plus,
  Target,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Video
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface AutomationRule {
  id: string;
  name: string;
  ruleType: string;
  channel: string;
  isActive: boolean;
  minIntentScore: number;
  minConfidence: number;
  cooldownMinutes: number;
  allowedActions: string[];
  createdAt: string;
}

const ACTION_TYPES = [
  { value: 'reply', label: 'Reply with AI', icon: MessageSquare },
  { value: 'calendar', label: 'Book Calendar', icon: Calendar },
  { value: 'video', label: 'Send Video', icon: Video },
  { value: 'send_email', label: 'Send Email', icon: Mail },
];

const CHANNELS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'email', label: 'Email' },
  { value: 'all', label: 'All Channels' },
];

const RULE_TYPES = [
  { value: 'follow_up', label: 'Follow-Up Sequence' },
  { value: 'objection_handler', label: 'Objection Handler' },
  { value: 'meeting_booking', label: 'Meeting Booking' },
  { value: 're_engagement', label: 'Re-engagement' },
];

export default function AutomationBuilderPage() {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false); // Default to simple mode
  const [newRule, setNewRule] = useState({
    name: '',
    ruleType: 'follow_up',
    channel: 'all',
    minIntentScore: 60,
    minConfidence: 70,
    cooldownMinutes: 1440,
    allowedActions: ['reply'],
  });

  const { data: rules, isLoading } = useQuery<AutomationRule[]>({
    queryKey: ['/api/automation/rules'],
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newRule) => {
      return apiRequest('POST', '/api/automation/rules', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      setShowCreateForm(false);
      setNewRule({
        name: '',
        ruleType: 'follow_up',
        channel: 'email',
        minIntentScore: 60,
        minConfidence: 70,
        cooldownMinutes: 1440,
        allowedActions: ['reply'],
      });
      toast({ title: 'Rule created', description: 'Your automation rule is now active.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to create rule.', variant: 'destructive' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest('PATCH', `/api/automation/rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/automation/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/automation/rules'] });
      toast({ title: 'Rule deleted' });
    },
  });

  const toggleAction = (action: string) => {
    const current = newRule.allowedActions;
    if (current.includes(action)) {
      setNewRule({ ...newRule, allowedActions: current.filter(a => a !== action) });
    } else {
      setNewRule({ ...newRule, allowedActions: [...current, action] });
    }
  };

  return (
    <PageWrapper className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tighter flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary shadow-inner">
              <Brain className="h-8 w-8" />
            </div>
            Automation Builder
          </h1>
          <p className="text-muted-foreground font-medium mt-2 max-w-xl">
            Configure intelligent automation rules with deterministic decision governance.
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(true)} className="h-12 px-6 rounded-2xl font-black uppercase tracking-widest gap-2 shadow-lg shadow-primary/20">
          <Plus className="h-5 w-5" /> Deploy Rule
        </Button>
      </div>

      <Card className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Brain className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold">Intelligence-Governed Automation</h3>
              <p className="text-sm text-muted-foreground mt-1">
                AI NEVER acts without decision engine approval. Every action requires minimum intent
                and confidence scores. All decisions are logged with reasoning for full transparency.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Create Automation Rule
            </CardTitle>
            <CardDescription>
              Define intelligence thresholds and allowed actions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rule Name</Label>
                <Input
                  placeholder="e.g., High-Intent Follow-Up"
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Rule Type</Label>
                <Select
                  value={newRule.ruleType}
                  onValueChange={(value) => setNewRule({ ...newRule, ruleType: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Channel</Label>
              <Select
                value={newRule.channel}
                onValueChange={(value) => setNewRule({ ...newRule, channel: value })}
              >
                <SelectTrigger className="w-48">
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

            {/* Simple / Advanced Toggle */}
            <div className="flex items-center space-x-2">
              <Switch
                id="advanced-mode"
                checked={isAdvancedMode}
                onCheckedChange={setIsAdvancedMode}
              />
              <Label htmlFor="advanced-mode" className="cursor-pointer">
                Advanced Mode (Custom Thresholds)
              </Label>
            </div>

            {isAdvancedMode && (
              <>
                <div className="grid grid-cols-2 gap-6 pt-4 border-t">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Minimum Intent Score</Label>
                        <Badge variant="outline">{newRule.minIntentScore}%</Badge>
                      </div>
                      <Slider
                        value={[newRule.minIntentScore]}
                        onValueChange={([value]) => setNewRule({ ...newRule, minIntentScore: value })}
                        max={100}
                        step={5}
                        className="py-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        AI only acts when lead intent exceeds this threshold
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Minimum Confidence</Label>
                        <Badge variant="outline">{newRule.minConfidence}%</Badge>
                      </div>
                      <Slider
                        value={[newRule.minConfidence]}
                        onValueChange={([value]) => setNewRule({ ...newRule, minConfidence: value })}
                        max={100}
                        step={5}
                        className="py-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        AI confidence required before taking action
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 border-b pb-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Cooldown Period</Label>
                      <Badge variant="outline">{Math.floor(newRule.cooldownMinutes / 60)}h {newRule.cooldownMinutes % 60}m</Badge>
                    </div>
                    <Slider
                      value={[newRule.cooldownMinutes]}
                      onValueChange={([value]) => setNewRule({ ...newRule, cooldownMinutes: value })}
                      min={30}
                      max={4320}
                      step={30}
                      className="py-2"
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum time between automated actions to the same lead
                    </p>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-3">
              <Label>Allowed Actions</Label>
              <div className="flex flex-wrap gap-2">
                {ACTION_TYPES.map((action) => {
                  const isSelected = newRule.allowedActions.includes(action.value);
                  return (
                    <Button
                      key={action.value}
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => toggleAction(action.value)}
                      className="gap-2"
                    >
                      <action.icon className="h-4 w-4" />
                      {action.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate(newRule)}
                disabled={!newRule.name || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Rule
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList>
          <TabsTrigger value="active">Active Rules</TabsTrigger>
          <TabsTrigger value="all">All Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !rules?.filter(r => r.isActive).length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">No Active Rules</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create your first automation rule to get started
                </p>
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Rule
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ResponsiveGrid className="grid-cols-1 md:grid-cols-2 gap-4">
              {rules?.filter(r => r.isActive).map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(isActive) => toggleMutation.mutate({ id: rule.id, isActive })}
                  onDelete={() => deleteMutation.mutate(rule.id)}
                />
              ))}
            </ResponsiveGrid>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !rules?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Settings2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">No Rules Yet</h3>
                <p className="text-sm text-muted-foreground">
                  Start by creating your first automation rule
                </p>
              </CardContent>
            </Card>
          ) : (
            <ResponsiveGrid className="grid-cols-1 md:grid-cols-2 gap-4">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(isActive) => toggleMutation.mutate({ id: rule.id, isActive })}
                  onDelete={() => deleteMutation.mutate(rule.id)}
                />
              ))}
            </ResponsiveGrid>
          )}
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}

function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: AutomationRule;
  onToggle: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Card className={!rule.isActive ? 'opacity-60' : ''}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`p-2 rounded-lg ${rule.isActive ? 'bg-green-500/20' : 'bg-muted'}`}>
              {rule.isActive ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{rule.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {RULE_TYPES.find(t => t.value === rule.ruleType)?.label || rule.ruleType}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {rule.channel}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Switch
              checked={rule.isActive}
              onCheckedChange={onToggle}
            />
            <Button variant="ghost" size="icon" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Min Intent</div>
            <div className="font-semibold text-lg">{rule.minIntentScore}%</div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Min Confidence</div>
            <div className="font-semibold text-lg">{rule.minConfidence}%</div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Cooldown</div>
            <div className="font-semibold text-lg">
              {Math.floor(rule.cooldownMinutes / 60)}h
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          {rule.allowedActions?.map((action) => {
            const actionType = ACTION_TYPES.find(a => a.value === action);
            return actionType ? (
              <Badge key={action} variant="outline" className="gap-1">
                <actionType.icon className="h-3 w-3" />
                {actionType.label}
              </Badge>
            ) : null;
          })}
        </div>
      </CardContent>
    </Card>
  );
}
