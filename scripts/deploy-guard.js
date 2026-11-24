/**
 * Refuse to deploy over newer shared code.
 * spbc-supplier-sync and springfieldpeps are deployed by more than one Claude session.
 * On 2026-11-24 a deploy from an older checkout removed the Patriotic /partner-prices route.
 * This checks that everything on origin/master is already in what you are about to deploy,
 * and that there are no uncommitted changes. Run: node scripts/deploy-guard.js
 */
'use strict';
const { execSync } = require('child_process');

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function main() {
  try {
    run('git fetch -q origin');
  } catch (e) {
    console.error('deploy-guard: could not reach GitHub (git fetch failed). Not deploying blind.');
    process.exit(1);
  }
  const dirty = run('git status --porcelain --untracked-files=no');
  if (dirty) {
    console.error('deploy-guard: there are uncommitted changes. Commit them first, so what is live is in git:\n' + dirty);
    process.exit(1);
  }
  try {
    run('git merge-base --is-ancestor origin/master HEAD');
  } catch {
    const missing = run('git log --oneline HEAD..origin/master');
    console.error('deploy-guard: origin/master has commits that are not in this checkout. Deploying would undo them:\n' + missing +
      '\nFix: git merge --ff-only origin/master (or rebase), test, then deploy.');
    process.exit(1);
  }
  console.log(`deploy-guard: ok (${run('git rev-parse --short HEAD')} contains origin/master)`);
}

main();
