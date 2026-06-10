#!/usr/bin/env bash
# PostToolUse(Write|Edit) — prettier-format the file Claude just touched.
# Immediate feedback so style errors never accumulate (Playbook §5).
# ALWAYS exits 0: formatting must never block an edit.
set -euo pipefail

input="$(cat)"

# Extract tool_input.file_path (or .path) from the hook's stdin JSON via node.
file="$(printf '%s' "$input" | node -e '
let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
  try { const j=JSON.parse(s); const ti=j.tool_input||{};
        process.stdout.write(ti.file_path||ti.path||""); }
  catch { process.stdout.write(""); }
});' 2>/dev/null || true)"

[ -z "$file" ] && exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.css|*.yaml|*.yml)
    cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
    if [ -f "$file" ] && [ -x ./node_modules/.bin/prettier ]; then
      ./node_modules/.bin/prettier --write "$file" >/dev/null 2>&1 || true
    fi
    ;;
esac

exit 0
