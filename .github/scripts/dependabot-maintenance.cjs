'use strict';

const VALIDATION = 'pr-validation.yml';
const CODEQL = 'codeql.yml';
const DAY = 86400000;

function eligible(pull, repository) {
  return pull.state === 'open' && !pull.draft &&
    pull.user?.login === 'dependabot[bot]' && pull.base?.ref === 'dev' &&
    pull.base.repo?.full_name === repository && pull.head?.repo?.full_name === repository &&
    pull.head.ref.startsWith('dependabot/') &&
    pull.labels.some(label => label.name === 'automerge') &&
    /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?!?: .+/.test(pull.title);
}

function validated(run, pull, repository, jobs) {
  return run?.path === `.github/workflows/${VALIDATION}` &&
    run.event === 'pull_request' && run.actor?.login === 'dependabot[bot]' &&
    run.head_repository?.full_name === repository && run.head_sha === pull.head.sha &&
    run.status === 'completed' && run.conclusion === 'success' &&
    jobs.some(job => job.name === 'PR Gate' && job.status === 'completed' && job.conclusion === 'success') &&
    jobs.every(job => job.status === 'completed' && ['success', 'skipped'].includes(job.conclusion));
}

function latest(runs) {
  return [...runs].sort((a, b) => b.id - a.id)[0];
}

module.exports = async function maintain({github, context, core, rebaseGithub}) {
  const mode = (process.env.AUTOMERGE_MODE || 'off').toLowerCase();
  if (!['off', 'observe', 'active'].includes(mode)) throw new Error(`Invalid AUTOMERGE_MODE: ${mode}`);
  if (mode === 'off') return core.notice('Dependabot maintenance is disabled.');
  const dry = mode === 'observe' || process.env.DRY_RUN === 'true';
  const repo = context.repo;
  const repository = `${repo.owner}/${repo.repo}`;
  const rebaser = rebaseGithub || (process.env.REBASE_TOKEN ?
    new github.constructor({auth: process.env.REBASE_TOKEN}) : null);
  const rows = [];
  const note = message => { rows.push(message); core.info(message); };
  const act = async (description, operation) => {
    note(`${dry ? '[observe] ' : ''}${description}`);
    if (!dry) return operation();
  };
  const branch = async () => (await github.rest.repos.getBranch({...repo, branch: 'dev'})).data.commit.sha;
  const runsFor = async (workflow, extra = {}) => github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo, workflow_id: workflow, per_page: 100, ...extra,
  });
  const reportIncompleteRun = async run => {
    if (run.status !== 'completed' || run.conclusion === 'success') return;
    core.warning(`Run ${run.id} needs attention (${run.conclusion}); automatic retry is disabled: ${run.html_url}`);
  };

  // GITHUB_TOKEN merges do not emit ordinary push CI. Repair a missed dispatch
  // on the next event/schedule too, including a crash between merge and dispatch.
  async function reconcileDelivery() {
    const head = await branch();
    let ready = true;
    for (const workflow of [CODEQL]) {
      const runs = await runsFor(workflow, {branch: 'dev', head_sha: head});
      if (runs.some(run => run.status !== 'completed')) { ready = false; continue; }
      const run = latest(runs);
      if (!run) {
        ready = false;
        if (await branch() !== head) return false;
        await act(`Dispatch ${workflow} on dev (${head}).`, () => github.rest.actions.createWorkflowDispatch({
          ...repo, workflow_id: workflow, ref: 'dev',
        }));
      } else if (run.status !== 'completed' || run.conclusion !== 'success') {
        ready = false;
        await reportIncompleteRun(run);
      }
    }
    return ready;
  }

  try {
    if (['schedule', 'workflow_dispatch'].includes(context.eventName)) {
      // Refresh the schedule's activity through the Actions API, without dummy
      // source commits. Never re-enable a workflow deliberately disabled by a user.
      const {data: self} = await github.rest.actions.getWorkflow({
        ...repo, workflow_id: 'auto-merge-dependabot.yml',
      });
      if (self.state === 'active') await act('Keep the maintenance schedule active.', () =>
        github.rest.actions.enableWorkflow({...repo, workflow_id: self.id}));
    }
    const deliveryReady = await reconcileDelivery();
    const pulls = await github.paginate(github.rest.pulls.list, {...repo, state: 'open', base: 'dev', per_page: 100});
    const candidates = pulls.filter(pull => eligible(pull, repository));
    for (const listed of candidates) {
      try {
        const {data: pull} = await github.rest.pulls.get({...repo, pull_number: listed.number});
        if (!eligible(pull, repository)) continue;
        const base = await branch();
        const {data: comparison} = await github.rest.repos.compareCommits({
          ...repo, base, head: pull.head.sha,
        });
        if (comparison.merge_base_commit.sha !== base) {
          // Dependabot owns its branch. Ask its rebaser to refresh the branch so
          // the resulting bot push starts the normal unprivileged PR CI.
          const comments = await github.paginate(github.rest.issues.listComments, {
            ...repo, issue_number: pull.number, per_page: 100,
          });
          const marker = '<!-- dependabot-maintenance:rebase -->';
          const recent = comments.some(comment => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association) &&
            comment.body?.includes(marker) && comment.body.includes(`(${base}).`) &&
            Date.now() - Date.parse(comment.created_at) < DAY);
          if (!rebaser && !dry) { core.warning('PAT_TOKEN is required only to request a Dependabot rebase.'); continue; }
          if (!recent) await act(`Request Dependabot rebase for #${pull.number} onto dev ${base}.`, () =>
            rebaser.rest.issues.createComment({...repo, issue_number: pull.number,
              body: `@dependabot rebase\n\n${marker}\nRevalidate against the current dev branch (${base}).`}));
          else note(`Waiting for Dependabot to rebase #${pull.number}.`);
          continue;
        }

        const run = latest(await runsFor(VALIDATION, {event: 'pull_request', head_sha: pull.head.sha}));
        if (!run) { core.warning(`No PR Validation run for #${pull.number} at ${pull.head.sha}.`); continue; }
        if (run.status !== 'completed' || run.conclusion !== 'success') { await reportIncompleteRun(run); continue; }
        const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
          ...repo, run_id: run.id, filter: 'latest', per_page: 100,
        });
        if (!validated(run, pull, repository, jobs)) throw new Error(`Untrusted or incomplete validation for #${pull.number}`);
        const {data: fresh} = await github.rest.pulls.get({...repo, pull_number: pull.number});
        if (!eligible(fresh, repository) || fresh.head.sha !== pull.head.sha || await branch() !== base) {
          note(`State changed for #${pull.number}; reconcile again on the next event.`);
          continue;
        }
        if (!deliveryReady) { note(`Waiting for current dev delivery before merging #${pull.number}.`); continue; }
        // Let GitHub enforce PR Gate, strict baseline and CodeQL rules with the
        // repository-scoped Actions token. Never use an administrator PAT here.
        const result = await act(`Merge validated Dependabot #${pull.number} at ${pull.head.sha}.`, () =>
          github.rest.pulls.merge({...repo, pull_number: pull.number, sha: pull.head.sha,
            merge_method: 'squash', commit_title: `${pull.title} (#${pull.number})`}));
        if (dry) continue;
        if (!result.data.merged) throw new Error(result.data.message);
        note(`Merged #${pull.number} as ${result.data.sha}.`);
        await reconcileDelivery();
        break;
      } catch (error) {
        if ([405, 409].includes(error.status)) core.warning(`GitHub deferred merge: ${error.message}`);
        else core.setFailed(error.message);
      }
    }

  } finally {
    await core.summary.addHeading('Dependabot maintenance').addList(rows.length ? rows : ['No action needed.']).write();
  }
};
module.exports.eligible = eligible;
module.exports.validated = validated;
module.exports.latest = latest;
