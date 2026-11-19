#!/usr/bin/env bash
# PreToolUse(Bash) — block obviously destructive commands before they run.
# exit 2 = block + feed stderr back to Claude (Playbook §5). Second safety
# layer next to the `deny` permission rules.
set -euo pipefail

input="$(cat)"

cmd="$(printf '%s' "$input" | node -e '
let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
  try { const j=JSON.parse(s); process.stdout.write((j.tool_input&&j.tool_input.command)||""); }
  catch { process.stdout.write(""); }
});' 2>/dev/null || true)"

[ -z "$cmd" ] && exit 0

# Patterns: sudo · rm -rf/-fr · git push --force (but NOT --force-with-lease)
# · mkfs · dd if= · fork bomb · chmod 777 on root-ish paths.
if printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_])sudo([^[:alnum:]_]|$)|rm[[:space:]]+-[[:alnum:]]*r[[:alnum:]]*f|rm[[:space:]]+-[[:alnum:]]*f[[:alnum:]]*r|git[[:space:]]+push[[:space:]].*--force([^-]|$)|mkfs|dd[[:space:]]+if=|:\(\)\s*\{|chmod[[:space:]]+-R?[[:space:]]*777[[:space:]]+/'; then
  echo "guard-bash.sh: blocked a destructive command pattern. If intentional, run it yourself in a terminal." >&2
  exit 2
fi

exit 0
