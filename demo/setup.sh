#!/usr/bin/env bash
# Builds a throwaway repo with 3 extra worktrees for the agent-fleet demo, set
# up so the pane has something to say about every branch's health:
#   - main moves on after the branches start, so they fall behind it
#   - feat/auth and fix/billing both rewrite README's title: a predicted conflict
#   - both also have unsaved changes to the same new file, src/config.ts
# Usage: bash demo/setup.sh   (safe to re-run: it wipes and rebuilds demo/repo)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/repo"
WT="$HERE/worktrees"
rm -rf "$REPO" "$WT"
mkdir -p "$REPO/src"
cd "$REPO"
commit() { git add . && git -c user.name=demo -c user.email=demo@local commit -qm "$1"; }

git init -q -b main
echo "export const login = () => {}" > src/auth.ts
echo "export const pay = () => {}"   > src/billing.ts
printf '# demo app\n\nA tiny app the agent-fleet demo works on.\n' > README.md
commit "initial commit"

for b in feat/auth fix/billing chore/docs; do
  git worktree add -q -b "$b" "$WT/${b//\//-}"
done

echo "export const VERSION = 2" > src/version.ts
commit "bump version"

(
  cd "$WT/feat-auth"
  sed -i '1s/.*/# demo app, now with oauth/' README.md && commit "readme: mention oauth"
  echo "export const oauth = () => {}" >> src/auth.ts && commit "add oauth stub"
)
(
  cd "$WT/fix-billing"
  sed -i '1s/.*/# demo app, now with refunds/' README.md && commit "readme: mention refunds"
)

# Uncommitted changes, two of them to the same file.
echo "// TODO oauth"                            >> "$WT/feat-auth/src/auth.ts"
echo "export const config = { oauth: true }"    >  "$WT/feat-auth/src/config.ts"
echo "export const config = { refunds: true }"  >  "$WT/fix-billing/src/config.ts"
echo "// refund"                                >> "$WT/fix-billing/src/billing.ts"

git worktree list
echo
echo "Repo ready: $REPO"
