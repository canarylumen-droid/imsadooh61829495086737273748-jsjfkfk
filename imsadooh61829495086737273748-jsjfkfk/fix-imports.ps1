# fix-imports.ps1
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Audnix AI Import Path Fixer" -ForegroundColor Cyan

$replacements = @(
  @{ P = "'\.\.\/lib\/storage\/storage\.js'"; R = "'@shared/lib/storage/storage.js'" },
  @{ P = "'\.\.\/storage\/storage\.js'"; R = "'@shared/lib/storage/storage.js'" },
  @{ P = "'\.\.\/\.\.\/lib\/storage\/storage\.js'"; R = "'@shared/lib/storage/storage.js'" },
  @{ P = "'\.\.\/lib\/storage\/blob-storage\.js'"; R = "'@shared/lib/storage/blob-storage.js'" },
  @{ P = "'\.\.\/lib\/db\/db\.js'"; R = "'@shared/lib/db/db.js'" },
  @{ P = "'\.\.\/db\/db\.js'"; R = "'@shared/lib/db/db.js'" },
  @{ P = "'\.\.\/\.\.\/lib\/db\/db\.js'"; R = "'@shared/lib/db/db.js'" },
  @{ P = "'\.\.\/lib\/redis\/redis\.js'"; R = "'@shared/lib/redis/redis.js'" },
  @{ P = "'\.\.\/redis\/redis\.js'"; R = "'@shared/lib/redis/redis.js'" },
  @{ P = "'\.\.\/lib\/redis\/brand-pdf-storage\.js'"; R = "'@shared/lib/redis/brand-pdf-storage.js'" },
  @{ P = "'\.\.\/lib\/queues\/redis-config\.js'"; R = "'@shared/lib/queues/redis-config.js'" },
  @{ P = "'\.\.\/lib\/queues\/outreach-queue\.js'"; R = "'@shared/lib/queues/outreach-queue.js'" },
  @{ P = "'\.\.\/lib\/realtime\/websocket-sync\.js'"; R = "'@shared/lib/realtime/websocket-sync.js'" },
  @{ P = "'\.\.\/lib\/realtime\/socket-service\.js'"; R = "'@shared/lib/realtime/socket-service.js'" },
  @{ P = "'\.\.\/realtime\/websocket-sync\.js'"; R = "'@shared/lib/realtime/websocket-sync.js'" },
  @{ P = "'\.\.\/lib\/crypto\/encryption\.js'"; R = "'@shared/lib/crypto/encryption.js'" },
  @{ P = "'\.\.\/crypto\/encryption\.js'"; R = "'@shared/lib/crypto/encryption.js'" },
  @{ P = "'\.\.\/lib\/ai\/core\/ai-service\.js'"; R = "'@shared/lib/ai/core/ai-service.js'" },
  @{ P = "'\.\.\/lib\/ai\/core\/conversation-ai\.js'"; R = "'@services/brain-worker/src/ai-lib/core/conversation-ai.js'" },
  @{ P = "'\.\.\/lib\/ai\/core\/follow-up-worker\.js'"; R = "'@services/brain-worker/src/ai-lib/core/follow-up-worker.js'" },
  @{ P = "'\.\.\/lib\/ai\/formatters\/smart-replies\.js'"; R = "'@services/brain-worker/src/ai-lib/formatters/smart-replies.js'" },
  @{ P = "'\.\.\/lib\/ai\/engines\/lead-scoring\.js'"; R = "'@services/brain-worker/lead-scoring.js'" },
  @{ P = "'\.\.\/lib\/ai\/engines\/analytics-engine\.js'"; R = "'@services/brain-worker/src/ai-lib/engines/analytics-engine.js'" },
  @{ P = "'\.\.\/lib\/ai\/engines\/deal-evaluator\.js'"; R = "'@services/brain-worker/src/ai-lib/engines/deal-evaluator.js'" },
  @{ P = "'\.\.\/lib\/ai\/analyzers\/competitor-detection\.js'"; R = "'@services/brain-worker/src/ai-lib/analyzers/competitor-detection.js'" },
  @{ P = "'\.\.\/lib\/ai\/specialized\/price-negotiation\.js'"; R = "'@services/brain-worker/src/ai-lib/specialized/price-negotiation.js'" },
  @{ P = "'\.\.\/lib\/ai\/analyzers\/comment-detection\.js'"; R = "'@services/brain-worker/src/ai-lib/analyzers/comment-detection.js'" },
  @{ P = "'\.\.\/lib\/ai\/utils\/csv-mapper\.js'"; R = "'@shared/lib/imports/csv-mapper.js'" },
  @{ P = "'\.\.\/lib\/ai\/utils\/body-parser\.js'"; R = "'@shared/lib/ai/utils/body-parser.js'" },
  @{ P = "'\.\.\/lib\/ai\/utils\/model-config\.js'"; R = "'@shared/lib/ai/utils/model-config.js'" },
  @{ P = "'\.\.\/lib\/ai\/context\/personality-learner\.js'"; R = "'@services/brain-worker/src/ai-lib/context/personality-learner.js'" },
  @{ P = "'\.\.\/lib\/ai\/context\/vector-search\.js'"; R = "'@services/brain-worker/src/ai-lib/context/vector-search.js'" },
  @{ P = "'\.\.\/lib\/email\/imap-idle-manager\.js'"; R = "'@services/email-service/src/email/imap-idle-manager.js'" },
  @{ P = "'\.\.\/lib\/email\/email-sync-worker\.js'"; R = "'@services/email-service/src/email/email-sync-worker.js'" },
  @{ P = "'\.\.\/lib\/email\/dns-verification\.js'"; R = "'@services/email-service/src/email/dns-verification.js'" },
  @{ P = "'\.\.\/lib\/email\/bounce-handler\.js'"; R = "'@services/email-service/src/email/bounce-handler.js'" },
  @{ P = "'\.\.\/lib\/email\/smtp-abuse-protection\.js'"; R = "'@services/email-service/src/email/smtp-abuse-protection.js'" },
  @{ P = "'\.\.\/lib\/email\/email-warmup-worker\.js'"; R = "'@services/email-service/src/email/email-warmup-worker.js'" },
  @{ P = "'\.\.\/lib\/email\/email-tracking\.js'"; R = "'@services/email-service/src/email/email-tracking.js'" },
  @{ P = "'\.\.\/lib\/email\/reputation-monitor\.js'"; R = "'@services/email-service/src/email/reputation-monitor.js'" },
  @{ P = "'\.\.\/lib\/email\/email-discovery\.js'"; R = "'@services/email-service/src/email/email-discovery.js'" },
  @{ P = "'\.\.\/lib\/channels\/email\.js'"; R = "'@shared/lib/channels/email.js'" },
  @{ P = "'\.\.\/lib\/channels\/instagram\.js'"; R = "'@shared/lib/providers/instagram.js'" },
  @{ P = "'\.\.\/lib\/auth\/twilio-email-otp\.js'"; R = "'@services/api-gateway/src/auth/twilio-email-otp.js'" },
  @{ P = "'\.\.\/email\/otp-templates\.js'"; R = "'@shared/lib/notifications/otp-templates.js'" },
  @{ P = "'\.\.\/lib\/oauth\/gmail\.js'"; R = "'@services/api-gateway/src/oauth/gmail.js'" },
  @{ P = "'\.\.\/lib\/oauth\/calendly\.js'"; R = "'@services/api-gateway/src/oauth/calendly.js'" },
  @{ P = "'\.\.\/lib\/oauth\/google-calendar\.js'"; R = "'@services/api-gateway/src/oauth/google-calendar.js'" },
  @{ P = "'\.\.\/lib\/oauth\/instagram\.js'"; R = "'@services/api-gateway/src/oauth/instagram.js'" },
  @{ P = "'\.\.\/lib\/calendar\/calendly\.js'"; R = "'@services/api-gateway/src/oauth/calendly.js'" },
  @{ P = "'\.\.\/lib\/calendar\/google-calendar\.js'"; R = "'@shared/lib/calendar/google-calendar.js'" },
  @{ P = "'\.\.\/lib\/calendar\/calendar-booking\.js'"; R = "'@shared/lib/calendar/calendar-booking.js'" },
  @{ P = "'\.\.\/config\/oauth-redirects\.js'"; R = "'@shared/config/config/oauth-redirects.js'" },
  @{ P = "'\.\.\/lib\/monitoring\/worker-health\.js'"; R = "'@shared/lib/monitoring/worker-health.js'" },
  @{ P = "'\.\.\/lib\/analytics\/stats-service\.js'"; R = "'@shared/lib/analytics/stats-service.js'" },
  @{ P = "'\.\.\/lib\/billing\/stripe\.js'"; R = "'@shared/lib/billing/stripe.js'" },
  @{ P = "'\.\.\/lib\/sales-engine\/outreach-engine\.js'"; R = "'@services/outreach-worker/src/sales-engine/outreach-engine.js'" },
  @{ P = "'\.\.\/services\/outreach\/workers\/outreach-engine\.js'"; R = "'@services/outreach-worker/src/sales-engine/outreach-engine.js'" },
  @{ P = "'\.\.\/lib\/outreach\/outreach-runner\.js'"; R = "'@services/outreach-worker/src/outreach-lib/outreach-runner.js'" },
  @{ P = "'\.\.\/services\/ai\/workers\/lead-enrichment-worker\.js'"; R = "'@services/brain-worker/workers/lead-enrichment-worker.js'" },
  @{ P = "'\.\.\/services\/orchestrator\/agents\/universal-sales-agent\.js'"; R = "'@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js'" },
  @{ P = "'\.\.\/services\/orchestrator\/agents\/universal-sales-agent-integrated\.js'"; R = "'@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js'" },
  @{ P = "'\.\.\/lib\/imports\/lead-importer\.js'"; R = "'@shared/lib/imports/lead-importer.js'" },
  @{ P = "'\.\.\/lib\/imports\/paged-email-importer\.js'"; R = "'@shared/lib/imports/paged-email-importer.js'" },
  @{ P = "'\.\.\/lib\/scraping\/email-verifier\.js'"; R = "'@shared/lib/scraping/email-verifier.js'" },
  @{ P = "'\.\.\/lib\/media\/pdf-processor\.js'"; R = "'@shared/lib/media/pdf-processor.js'" },
  @{ P = "'\.\.\/lib\/utils\/validation\.js'"; R = "'@shared/lib/utils/validation.js'" },
  @{ P = "'\.\.\/\.\.\/shared\/types\.js'"; R = "'@shared/types.js'" },
  @{ P = "'\.\.\/\.\.\/\.\.\/\.\.\/shared\/types\.js'"; R = "'@shared/types.js'" },
  @{ P = "'\.\.\/\.\.\/\.\.\/shared\/types\.js'"; R = "'@shared/types.js'" }
)

$scanDirs = @("services", "server\lib", "server\scripts")
$totalFixed = 0
$filesFixed = 0

foreach ($dir in $scanDirs) {
  $fullDir = Join-Path $projectRoot $dir
  if (-not (Test-Path $fullDir)) { continue }
  $tsFiles = Get-ChildItem -Path $fullDir -Recurse -Filter "*.ts" | Where-Object { $_.FullName -notmatch "node_modules|\\dist\\" }
  foreach ($file in $tsFiles) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    if ($null -eq $content) { continue }
    $original = $content
    $count = 0
    foreach ($rule in $replacements) {
      $newContent = [regex]::Replace($content, $rule.P, $rule.R)
      if ($newContent -ne $content) {
        $count += ([regex]::Matches($content, $rule.P)).Count
        $content = $newContent
      }
    }
    if ($content -ne $original) {
      [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.Encoding]::UTF8)
      $rel = $file.FullName.Replace($projectRoot + "\", "")
      Write-Host "  FIXED $count import(s): $rel" -ForegroundColor Green
      $totalFixed += $count
      $filesFixed++
    }
  }
}

# Fix multi-channel-orchestrator.ts (uses ./ relative paths)
$orchFile = Join-Path $projectRoot "server\lib\multi-channel-orchestrator.ts"
if (Test-Path $orchFile) {
  $c = [System.IO.File]::ReadAllText($orchFile, [System.Text.Encoding]::UTF8)
  $orig = $c
  $c = [regex]::Replace($c, "'\.\/storage\/storage\.js'", "'@shared/lib/storage/storage.js'")
  $c = [regex]::Replace($c, "'\.\/db\/db\.js'", "'@shared/lib/db/db.js'")
  $c = [regex]::Replace($c, "'\.\/channels\/email\.js'", "'@shared/lib/channels/email.js'")
  $c = [regex]::Replace($c, "'\.\/channels\/instagram\.js'", "'@shared/lib/providers/instagram.js'")
  if ($c -ne $orig) {
    [System.IO.File]::WriteAllText($orchFile, $c, [System.Text.Encoding]::UTF8)
    Write-Host "  FIXED multi-channel-orchestrator.ts" -ForegroundColor Green
  }
}

# Add Sentry import to api-gateway/index.ts
$gwFile = Join-Path $projectRoot "services\api-gateway\index.ts"
if (Test-Path $gwFile) {
  $c = [System.IO.File]::ReadAllText($gwFile, [System.Text.Encoding]::UTF8)
  if ($c -notmatch "import \* as Sentry from") {
    $c = [regex]::Replace($c, '(import "dotenv/config";)', "`$1`nimport * as Sentry from '@sentry/node';")
    [System.IO.File]::WriteAllText($gwFile, $c, [System.Text.Encoding]::UTF8)
    Write-Host "  ADDED Sentry import to api-gateway/index.ts" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Done! Fixed $totalFixed imports across $filesFixed files." -ForegroundColor Cyan
