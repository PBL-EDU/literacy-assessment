#!/usr/bin/env bash
set -euo pipefail

# Daily logical backup for the independent literacy-db container.
# Cron: 30 3 * * * /opt/literacy/server/deploy/backup.sh
ROOT="${LITERACY_ROOT:-/opt/literacy}"
BACKUP_DIR="${ROOT}/server/backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%F)"
docker exec literacy-db pg_dump -U literacy literacy \
  | gzip > "${BACKUP_DIR}/literacy-${STAMP}.sql.gz"
chmod 600 "${BACKUP_DIR}/literacy-${STAMP}.sql.gz"

# Keep 14 days.
find "$BACKUP_DIR" -name 'literacy-*.sql.gz' -mtime +14 -delete
