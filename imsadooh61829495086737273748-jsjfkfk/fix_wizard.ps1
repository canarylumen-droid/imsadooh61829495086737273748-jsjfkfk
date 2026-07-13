$content = Get-Content 'client/src/components/outreach/UnifiedCampaignWizard.tsx' -Raw
$content = $content -replace '<div className="bg-muted/40 p-1.5 rounded-2xl border border-border/10 mb-6">\s+<TabsList className="h-10 w-full bg-transparent p-0 flex gap-1">', '<TabsList className="h-10 w-full bg-muted/40 p-1.5 rounded-2xl border border-border/10 mb-6 flex gap-1">'
$content = $content -replace '</TabsList>\s+</div>', '</TabsList>'
$content | Set-Content 'client/src/components/outreach/UnifiedCampaignWizard.tsx'
