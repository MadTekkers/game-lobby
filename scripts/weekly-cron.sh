#!/usr/bin/env bash
# Sunday 3:00 AM America/Chicago job (installed in the box crontab). Generates next week's puzzles
# into Supabase (no redeploy needed), then commits + pushes the JSON snapshots.
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH" HOME="${HOME:-/root}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/workspace/logs/weekly-$(date +%Y%m%d-%H%M).log
mkdir -p /workspace/logs
exec >>"$LOG" 2>&1
echo "== weekly run $(date) =="
cd "$REPO"
git pull --rebase --autostash -q || echo "git pull failed (continuing)"
npm run weekly
node scripts/validateConnections.mjs | tail -3 || echo "WARNING: connections validation failed"
git add puzzles/weekly
if git diff --cached --quiet; then echo "no snapshot changes"; else
  git commit -q -m "weekly: puzzles for week of $(TZ=America/Chicago date -d 'next monday' +%Y-%m-%d)" && git push -q && echo "pushed"; fi
echo "== done $(date) =="
