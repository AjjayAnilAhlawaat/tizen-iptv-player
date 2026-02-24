#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# IPTV Performance Critic — GitHub Actions script
#
# Makes ONE call to the Anthropic Messages API (claude-opus-4-6).
# No agentic loop — Claude gets all source files and returns a
# single structured JSON critique.
#
# Outputs:
#   - GitHub Step Summary (always)
#   - PR comment that replaces any previous critique (on pull_request)
#   - Exits 1 (fails the status check) if CRITICAL or HIGH issues found
#
# Required env vars:
#   ANTHROPIC_API_KEY   — Anthropic API key (from repo secret)
#   GH_TOKEN            — GitHub token (from secrets.GITHUB_TOKEN)
#   GITHUB_EVENT_NAME   — provided by Actions runner
#   GITHUB_SHA          — provided by Actions runner
#   GITHUB_REPOSITORY   — provided by Actions runner
# ══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colours for runner log ─────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'; C='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${C}[critic]${NC} $*"; }
ok()   { echo -e "${G}[critic] ✅${NC} $*"; }
warn() { echo -e "${Y}[critic] ⚠️ ${NC} $*"; }
fail() { echo -e "${R}[critic] ❌${NC} $*"; }

# ── Guard: API key ─────────────────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  fail "ANTHROPIC_API_KEY secret is not set."
  fail "Go to: Settings → Secrets → Actions → New repository secret"
  fail "Name: ANTHROPIC_API_KEY   Value: sk-ant-..."
  exit 1
fi

# ── System prompt ──────────────────────────────────────────────
# Claude gets all source files and must return raw JSON only.
SYSTEM_PROMPT='You are a ruthless, expert-level performance engineer specialising
in Samsung Tizen TV applications, IPTV players, and constrained embedded browser
environments.

Analyse the provided source files and respond with a single JSON object.
NO markdown fences. NO prose before or after. RAW JSON ONLY.

Required schema (all fields mandatory):
{
  "score": <integer 0-100; start at 100, deduct CRITICAL=-20 HIGH=-10 MEDIUM=-5 LOW=-2>,
  "summary": "<3-5 sentence executive summary of overall health>",
  "issues": [
    {
      "severity":      "CRITICAL|HIGH|MEDIUM|LOW",
      "category":      "memory_leak|dom_thrashing|network|rendering|css|security|javascript",
      "file":          "<filename, e.g. app.js>",
      "title":         "<concise title, max 80 chars>",
      "description":   "<1-3 sentences: why this hurts on Tizen TV hardware>",
      "current_code":  "<verbatim problematic snippet with line numbers, max 12 lines>",
      "optimized_code":"<exact runnable replacement — not pseudocode>",
      "explanation":   "<technical explanation of the specific performance gain>"
    }
  ]
}

Hunt ruthlessly for:
- setInterval / setTimeout stored without clearInterval / clearTimeout
- querySelectorAll called inside keydown/keyup hot loops (O(n) per keypress)
- innerHTML = "" + full DOM rebuild on every page flip or category change
- fetch() calls without AbortController (race conditions on rapid navigation)
- HLS non-fatal stall / buffering errors silently ignored
- getBoundingClientRect() inside scroll or key handlers (forced synchronous reflow)
- Universal CSS selector * with box-sizing + margin + padding (hits pseudo-elements)
- @keyframes animations running on display:none / inactive screens
- transform: scale on :focus (unnecessary GPU composite layer promotion)
- CDN <script> tags missing integrity= SRI hash
- config.xml <access origin="*"> combined with <tizen:allow-navigation>*

Cite exact line numbers. current_code must be verbatim from the file.
optimized_code must be a drop-in replacement — exact, runnable code.'

# ── Read source files & build API payload ─────────────────────
log "Reading source files…"

# jq --rawfile reads each file as a raw string and handles all JSON escaping.
# The user message embeds all four files so Claude gets the full picture.
PAYLOAD=$(jq -n \
  --rawfile app_js    app.js      \
  --rawfile style_css style.css   \
  --rawfile idx_html  index.html  \
  --rawfile cfg_xml   config.xml  \
  --arg     sys       "$SYSTEM_PROMPT" \
  '{
    model:      "claude-opus-4-6",
    max_tokens: 4096,
    system:     $sys,
    messages: [{
      role:    "user",
      content: (
        "Analyse these Tizen IPTV source files for every performance defect:\n\n" +
        "[FILE: app.js]\n"      + $app_js    + "\n\n" +
        "[FILE: style.css]\n"   + $style_css + "\n\n" +
        "[FILE: index.html]\n"  + $idx_html  + "\n\n" +
        "[FILE: config.xml]\n"  + $cfg_xml
      )
    }]
  }')

# ── Call the Anthropic Messages API ───────────────────────────
log "Calling Claude claude-opus-4-6 (one-shot — not an agentic loop)…"

HTTP_CODE=$(curl -s -o /tmp/critique_response.json -w "%{http_code}" \
  --max-time 120 \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d "$PAYLOAD" \
  "https://api.anthropic.com/v1/messages")

if [ "$HTTP_CODE" -ne 200 ]; then
  fail "Anthropic API returned HTTP ${HTTP_CODE}"
  cat /tmp/critique_response.json
  exit 1
fi

ok "API responded HTTP ${HTTP_CODE}"

# ── Extract & validate the JSON critique ──────────────────────
RAW_TEXT=$(jq -r '.content[0].text' /tmp/critique_response.json)

# Strip accidental markdown fences if Claude wrapped the JSON
CRITIQUE=$(echo "$RAW_TEXT" \
  | sed 's/^```json//;s/^```//' \
  | sed 's/```$//' \
  | sed '/^$/d' \
  | tr -d '\000-\010\013-\037')   # strip control chars

if ! echo "$CRITIQUE" | jq empty 2>/dev/null; then
  fail "Claude did not return valid JSON. Raw text:"
  echo "$RAW_TEXT" | head -60
  exit 1
fi

ok "JSON critique parsed successfully"

# ── Extract counts ─────────────────────────────────────────────
SCORE=$(echo "$CRITIQUE"    | jq -r '.score // 0')
SUMMARY=$(echo "$CRITIQUE"  | jq -r '.summary // "No summary provided."')
TOTAL=$(echo "$CRITIQUE"    | jq '[.issues // [] | .[]] | length')
N_CRIT=$(echo "$CRITIQUE"   | jq '[.issues[]? | select(.severity=="CRITICAL")] | length')
N_HIGH=$(echo "$CRITIQUE"   | jq '[.issues[]? | select(.severity=="HIGH")]     | length')
N_MED=$(echo "$CRITIQUE"    | jq '[.issues[]? | select(.severity=="MEDIUM")]   | length')
N_LOW=$(echo "$CRITIQUE"    | jq '[.issues[]? | select(.severity=="LOW")]      | length')

log "Score: ${SCORE}/100  |  Issues: ${TOTAL}  (CRIT:${N_CRIT} HIGH:${N_HIGH} MED:${N_MED} LOW:${N_LOW})"

# ── Score badge ────────────────────────────────────────────────
if   [ "$SCORE" -ge 80 ]; then SCORE_BADGE="🟢 ${SCORE}/100"
elif [ "$SCORE" -ge 60 ]; then SCORE_BADGE="🟡 ${SCORE}/100"
elif [ "$SCORE" -ge 40 ]; then SCORE_BADGE="🟠 ${SCORE}/100"
else                            SCORE_BADGE="🔴 ${SCORE}/100"
fi

# ── Build per-issue markdown blocks ───────────────────────────
# jq generates each issue section; sorted by severity.
ISSUES_MD=$(echo "$CRITIQUE" | jq -r '
  def sev_rank:
    if . == "CRITICAL" then 0
    elif . == "HIGH"   then 1
    elif . == "MEDIUM" then 2
    else 3 end;

  def sev_icon:
    if . == "CRITICAL" then "🔴"
    elif . == "HIGH"   then "🟠"
    elif . == "MEDIUM" then "🟡"
    else "🟢" end;

  def lang:
    if   endswith(".css")  then "css"
    elif endswith(".xml")  then "xml"
    elif endswith(".html") then "html"
    else "javascript" end;

  (.issues // [])
  | sort_by(.severity | sev_rank)
  | .[]
  | (
      "<details>\n" +
      "<summary><strong>" +
        (.severity | sev_icon) + " " + .severity +
        " &nbsp;·&nbsp; `" + .file + "` &nbsp;·&nbsp; " + .title +
      "</strong></summary>\n\n" +
      .description + "\n\n" +
      "**Current (problematic):**\n" +
      "```" + (.file | lang) + "\n" +
      .current_code + "\n```\n\n" +
      "**Optimized (fix):**\n" +
      "```" + (.file | lang) + "\n" +
      .optimized_code + "\n```\n\n" +
      "> **Why this fix works:** " + .explanation + "\n\n" +
      "</details>\n"
    )
')

# ── Assemble full markdown report ─────────────────────────────
SHORT_SHA="${GITHUB_SHA:0:7}"

REPORT="## 🎬 IPTV Performance Critique

> Powered by **Claude claude-opus-4-6** · Runs in parallel with the build · Hard merge gate on CRITICAL / HIGH

| | |
|---|---|
| **Score** | ${SCORE_BADGE} |
| **Total issues** | ${TOTAL} |
| 🔴 CRITICAL | ${N_CRIT} |
| 🟠 HIGH | ${N_HIGH} |
| 🟡 MEDIUM | ${N_MED} |
| 🟢 LOW | ${N_LOW} |
| **Commit** | \`${SHORT_SHA}\` |

### Executive Summary

${SUMMARY}

---

### Issues Found

${ISSUES_MD}

---
*Generated by [IPTV Performance Critic](.github/workflows/ci.yml) — commit \`${SHORT_SHA}\`*"

# ── Write to GitHub Step Summary ──────────────────────────────
echo "$REPORT" >> "$GITHUB_STEP_SUMMARY"
ok "Written to GitHub Step Summary"

# ── Post / update PR comment ──────────────────────────────────
if [ "${GITHUB_EVENT_NAME}" = "pull_request" ]; then
  PR_NUMBER=$(jq -r '.pull_request.number' "${GITHUB_EVENT_PATH}")
  log "Posting critique to PR #${PR_NUMBER}…"

  # Delete the previous critique comment so we don't spam the PR thread
  PREV_ID=$(gh api \
    "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    --jq '.[] | select(.body | startswith("## 🎬 IPTV Performance Critique")) | .id' \
    | head -1)

  if [ -n "${PREV_ID:-}" ]; then
    gh api -X DELETE "repos/${GITHUB_REPOSITORY}/issues/comments/${PREV_ID}" \
      --silent || true
    log "Deleted previous critique comment #${PREV_ID}"
  fi

  echo "$REPORT" | gh pr comment "$PR_NUMBER" --body-file -
  ok "Critique posted to PR #${PR_NUMBER}"
else
  log "Push event — critique written to Step Summary (no PR to comment on)"
fi

# ── Hard gate: fail the status check if CRITICAL or HIGH found ─
echo ""
if [ "$N_CRIT" -gt 0 ] || [ "$N_HIGH" -gt 0 ]; then
  fail "Performance gate FAILED"
  fail "  🔴 CRITICAL: ${N_CRIT}   🟠 HIGH: ${N_HIGH}"
  fail "Fix all CRITICAL and HIGH issues before this PR can be merged."
  exit 1
else
  ok "Performance gate PASSED — Score: ${SCORE}/100"
  ok "No CRITICAL or HIGH issues. MEDIUM/LOW issues are advisory only."
fi
