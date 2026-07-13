#!/bin/bash
# =============================================================================
# Audnix AI — Database Backup Script (Neon PostgreSQL)
# =============================================================================
# Backs up your Neon DB to a timestamped file in S3.
# Run daily via cron: 0 3 * * * /path/to/audnix/scripts/backup-db.sh
# =============================================================================

set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$APP_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="audnix_backup_${TIMESTAMP}.sql"
S3_BUCKET="${S3_BUCKET_NAME:-}"
RETENTION_DAYS=7

# Load DATABASE_URL from .env if not set
if [ -z "$DATABASE_URL" ] && [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | grep DATABASE_URL | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set!"
    exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "📦 Creating backup: $BACKUP_FILE"
pg_dump "$DATABASE_URL" > "$BACKUP_DIR/$BACKUP_FILE"

# Compress
gzip -f "$BACKUP_DIR/$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

echo "✅ Backup created: $BACKUP_FILE ($(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1))"

# Upload to S3 if configured
if [ -n "$S3_BUCKET" ] && command -v aws &> /dev/null; then
    echo "☁️  Uploading to S3..."
    aws s3 cp "$BACKUP_DIR/$BACKUP_FILE" "s3://$S3_BUCKET/backups/$BACKUP_FILE"
    echo "✅ Uploaded to s3://$S3_BUCKET/backups/$BACKUP_FILE"
fi

# Clean old backups
echo "🧹 Cleaning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "audnix_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "✅ Backup complete!"
