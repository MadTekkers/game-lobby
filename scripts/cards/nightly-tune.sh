#!/usr/bin/env bash
# Nightly bot self-improvement: the cards edge function reviews past hands (card_hands), adjusts bot params from the review,
# runs A/B self-play verdicts and writes bot_params + bot_tuning_log. Needs CARDS_TUNE_SECRET (kept in /workspace/.secrets/cards-tune.env).
set -euo pipefail
[ -f /workspace/.secrets/cards-tune.env ] && . /workspace/.secrets/cards-tune.env
: "${CARDS_TUNE_SECRET:?set CARDS_TUNE_SECRET}"
curl -sS --fail-with-body -X POST https://egjypyjarmxnsalkbnsa.supabase.co/functions/v1/cards \
  -H 'Content-Type: application/json' -d "{\"action\":\"tune\",\"secret\":\"${CARDS_TUNE_SECRET}\"}"
echo
