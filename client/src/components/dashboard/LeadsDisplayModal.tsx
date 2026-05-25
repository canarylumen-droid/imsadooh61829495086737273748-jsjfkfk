import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Mail, Building2, Phone, MapPin, Globe, Linkedin } from "lucide-react";

interface Lead {
  name: string;
  email: string;
  company?: string;
  title?: string;
  phone?: string;
  location?: string;
  industry?: string;
  website?: string;
  linkedin?: string;
}

interface LeadsDisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  leads: Lead[];
  onConfirm?: () => void;
  isImporting?: boolean;
  canConfirm?: boolean;
}

export function LeadsDisplayModal({
  isOpen,
  onClose,
  leads,
  onConfirm,
  isImporting,
  canConfirm = true
}: LeadsDisplayModalProps) {
  const [visibleCount, setVisibleCount] = useState(50);
  const visibleLeads = leads.slice(0, visibleCount);
  const hasMore = leads.length > visibleCount;

  const handleShowMore = () => {
    setVisibleCount(prev => prev + 50);
  };

  // Identify all unique metadata keys across VISIBLE leads only to prevent freeze on large imports
  const allMetadataKeys = Array.from(new Set(
    visibleLeads.flatMap(l => Object.keys((l as any).metadata || {}).filter(k => !k.endsWith('_type') && k !== '_unmapped_cols'))
  )).sort();

  const renderValue = (val: any, type?: string) => {
    if (!val) return <span className="text-muted-foreground/30">—</span>;
    
    if (type === 'google_maps' || val.toString().includes('maps.google')) {
      return (
        <a href={val} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline group/link">
          <MapPin className="h-3 w-3" />
          <span className="truncate max-w-[120px]">View Map</span>
        </a>
      );
    }
    
    if (type === 'linkedin' || val.toString().includes('linkedin.com')) {
      return (
        <a href={val} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-blue-400 hover:underline">
          <Linkedin className="h-3 w-3" />
          <span className="truncate max-w-[120px]">LinkedIn</span>
        </a>
      );
    }

    if (type === 'website' || /^https?:\/\//i.test(val.toString())) {
      return (
        <a href={val} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
          <Globe className="h-3 w-3" />
          <span className="truncate max-w-[120px]">{val.toString().replace(/^https?:\/\//i, '')}</span>
        </a>
      );
    }

    return <span className="truncate max-w-[150px]">{val.toString()}</span>;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[96vw] sm:max-w-[90vw] md:max-w-7xl h-auto max-h-[90vh] p-0 flex flex-col overflow-hidden border-border/20 bg-card/98 backdrop-blur-2xl rounded-[1rem] sm:rounded-[2rem] shadow-2xl focus:outline-none">
        <DialogHeader className="p-6 md:p-8 pb-4 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <DialogTitle className="text-xl md:text-2xl font-bold tracking-tight">Intelligence Ingestion Preview</DialogTitle>
              <DialogDescription className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 mt-1">
                {leads.length} data points mapped and verified
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
               <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold uppercase tracking-widest text-[9px] px-2 py-0.5">
                AI MAPPED
              </Badge>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-bold uppercase tracking-widest text-[9px] px-2 py-0.5">
                {leads.length} ROWS
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 w-full">
            <div className="w-full overflow-x-auto pb-4 px-6">
              <table className="w-full text-left border-collapse table-auto">
                <thead className="sticky top-0 bg-background/95 backdrop-blur-xl z-20 border-b border-border/40">
                  <tr>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Identity</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Contact</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Company</th>
                    {allMetadataKeys.map(key => (
                      <th key={key} className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
                        {key.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/10">
                  {visibleLeads.map((lead: any, idx) => (
                    <tr key={idx} className="group hover:bg-primary/5 transition-colors border-b border-border/5">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-black">
                            {lead.name?.charAt(0) || '?'}
                          </div>
                          <div className="font-bold text-sm tracking-tight truncate max-w-[150px]">{lead.name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-0.5">
                          <div className="text-xs font-medium truncate max-w-[180px]">{lead.email}</div>
                          {lead.phone && <div className="text-[10px] text-muted-foreground">{lead.phone}</div>}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-xs font-semibold truncate max-w-[150px]">{lead.company || lead.metadata?.company || "—"}</div>
                      </td>
                      {allMetadataKeys.map(key => (
                        <td key={key} className="px-4 py-4">
                          <div className="text-xs font-medium">
                            {renderValue(lead.metadata?.[key], lead.metadata?.[`${key}_type`])}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div className="p-8 text-center bg-muted/5 pb-12">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleShowMore}
                    className="text-[10px] font-black tracking-widest uppercase text-primary hover:bg-primary/10 h-10 px-8 rounded-xl border border-primary/10"
                  >
                    Load More (+{Math.min(50, leads.length - visibleCount)} of {leads.length - visibleCount})
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {onConfirm && (
          <div className="p-4 md:p-6 border-t border-border/10 bg-card/80 backdrop-blur-lg flex flex-col sm:flex-row justify-end gap-3 shrink-0 z-50">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isImporting}
              className="font-bold rounded-2xl border-border/40 hover:bg-muted/50 h-12 w-full sm:w-auto text-[11px] uppercase tracking-widest"
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isImporting || !canConfirm}
              className="bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-[0.15em] rounded-2xl h-12 px-10 shadow-2xl shadow-primary/40 w-full sm:w-auto text-[11px] transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {isImporting ? (
                <>
                  <div className="h-4 w-4 mr-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  INITIALIZING...
                </>
              ) : (
                'Confirm & Import Data'
              )}
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
