'use strict';

const { execFileSync } = require('node:child_process');

const LABEL = 'needs-manual-update';
const MARKER = '<!-- auto-update-queue:conflict -->';

function enabledTime(pr) {
  return Date.parse(pr.autoMergeEnabledAt) || 0;
}

function queueOrder(prs) {
  return prs
    .filter(
      (pr) =>
        pr.state === 'OPEN' &&
        !pr.isDraft &&
        !pr.isCrossRepository &&
        pr.autoMergeEnabledAt
    )
    .sort((a, b) => enabledTime(a) - enabledTime(b) || a.number - b.number);
}

function isInFlight(pr) {
  return !(pr.checksState === 'FAILURE' || pr.checksState === 'ERROR');
}

function planQueue(prs) {
  const queue = queueOrder(prs);
  if (queue.length === 0) {
    return { action: 'none', reason: 'no open non-draft PRs with auto-merge enabled', candidates: [] };
  }
  const inFlight = queue.find((pr) => pr.behindBy === 0 && isInFlight(pr));
  if (inFlight) {
    return {
      action: 'none',
      reason: `PR #${inFlight.number} is up to date and awaiting checks or merge`,
      candidates: [],
    };
  }
  const candidates = queue.filter((pr) => pr.behindBy > 0);
  if (candidates.length === 0) {
    return { action: 'none', reason: 'no queued PR is behind main', candidates: [] };
  }
  return { action: 'update', reason: 'oldest behind PR first', candidates };
}

function isConflictError(err) {
  const text = `${err && err.message ? err.message : ''} ${err && err.stderr ? err.stderr : ''}`;
  return /merge conflict/i.test(text);
}

async function runQueue(prs, client, opts = {}) {
  const log = opts.log || (() => {});
  const dryRun = !!opts.dryRun;
  const plan = planQueue(prs);
  log(`queue: ${plan.action} (${plan.reason})`);
  const result = { plan, updated: null, conflicts: [] };
  if (plan.action !== 'update') return result;

  for (const pr of plan.candidates) {
    if (dryRun) {
      log(`dry-run: would update PR #${pr.number} (behind by ${pr.behindBy}, head ${pr.headSha})`);
      result.updated = pr.number;
      return result;
    }
    try {
      await client.updateBranch(pr);
      log(`updated PR #${pr.number}; waiting for its checks`);
      result.updated = pr.number;
      if (pr.labels.includes(LABEL)) await client.removeLabel(pr);
      return result;
    } catch (err) {
      if (!isConflictError(err)) throw err;
      log(`PR #${pr.number} has a merge conflict; skipping`);
      result.conflicts.push(pr.number);
      await client.flagConflict(pr);
    }
  }
  return result;
}

const QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100) {
      nodes {
        number state isDraft isCrossRepository headRefOid
        autoMergeRequest { enabledAt }
        labels(first: 50) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

function createGhClient({ repo, readToken, updateToken, run = execFileSync }) {
  const gh = (args, token) =>
    run('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GH_TOKEN: token },
    });
  const api = (args) => JSON.parse(gh(['api', ...args], readToken));
  const [owner, name] = repo.split('/');

  return {
    async listPrs() {
      const data = api(['graphql', '-f', `query=${QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`]);
      const out = [];
      for (const n of data.data.repository.pullRequests.nodes) {
        if (!n.autoMergeRequest) continue;
        const rollup = n.commits.nodes[0] && n.commits.nodes[0].commit.statusCheckRollup;
        const cmp = api([`repos/${repo}/compare/main...${n.headRefOid}`]);
        out.push({
          number: n.number,
          state: n.state,
          isDraft: n.isDraft,
          isCrossRepository: n.isCrossRepository,
          headSha: n.headRefOid,
          autoMergeEnabledAt: n.autoMergeRequest.enabledAt,
          labels: n.labels.nodes.map((l) => l.name),
          checksState: rollup ? rollup.state : null,
          behindBy: cmp.behind_by,
        });
      }
      return out;
    },
    async updateBranch(pr) {
      gh(
        ['api', '-X', 'PUT', `repos/${repo}/pulls/${pr.number}/update-branch`, '-f', `expected_head_sha=${pr.headSha}`],
        updateToken
      );
    },
    async removeLabel(pr) {
      try {
        gh(['api', '-X', 'DELETE', `repos/${repo}/issues/${pr.number}/labels/${LABEL}`], readToken);
      } catch (_) {
        // label already gone
      }
    },
    async flagConflict(pr) {
      try {
        gh(
          ['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${LABEL}`, '-f', 'color=d93f0b',
            '-f', 'description=Branch has a merge conflict with main; needs a manual update'],
          readToken
        );
      } catch (_) {
        // label already exists
      }
      const comments = api([`repos/${repo}/issues/${pr.number}/comments`, '--paginate']);
      const alreadyCommented = pr.labels.includes(LABEL) || comments.some((c) => c.body && c.body.includes(MARKER));
      if (!pr.labels.includes(LABEL)) {
        gh(['api', '-X', 'POST', `repos/${repo}/issues/${pr.number}/labels`, '-f', `labels[]=${LABEL}`], readToken);
      }
      if (alreadyCommented) return;
      const body =
        `${MARKER}\nThe auto-update queue could not bring this branch up to date with \`main\` because of a merge conflict. ` +
        'Resolve the conflict manually (merge or rebase `main` into the branch and push). ' +
        'The queue skips this PR until then and continues with the next one.';
      gh(['api', '-X', 'POST', `repos/${repo}/issues/${pr.number}/comments`, '-f', `body=${body}`], readToken);
    },
  };
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true';
  const repo = process.env.GITHUB_REPOSITORY;
  const readToken = process.env.GH_TOKEN;
  const updateToken = process.env.UPDATE_TOKEN;
  if (!updateToken && !dryRun) {
    console.log(
      'AUTO_UPDATE_TOKEN secret is not set; skipping. Branch updates made with GITHUB_TOKEN do not trigger ' +
        'required checks. See README "Merging PRs" for setup.'
    );
    return;
  }
  const client = createGhClient({ repo, readToken, updateToken });
  const prs = await client.listPrs();
  await runQueue(prs, client, { dryRun, log: (m) => console.log(m) });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stderr || err.message);
    process.exit(1);
  });
}

module.exports = { planQueue, queueOrder, runQueue, isConflictError, LABEL, MARKER };
