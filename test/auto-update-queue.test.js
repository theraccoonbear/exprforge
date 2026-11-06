'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { planQueue, runQueue, queueOrder, LABEL } = require('../scripts/auto-update-queue.js');

function pr(number, over = {}) {
  return {
    number, state: 'OPEN', isDraft: false, isCrossRepository: false, headSha: `sha${number}`,
    autoMergeEnabledAt: `2026-11-0${number}T00:00:00Z`, labels: [], checksState: 'SUCCESS', behindBy: 1,
    ...over,
  };
}

test('queueOrder: FIFO by auto-merge time, ignoring drafts, forks, closed, no auto-merge', () => {
  const prs = [
    pr(3, { autoMergeEnabledAt: '2026-11-01T00:00:00Z' }),
    pr(1, { autoMergeEnabledAt: '2026-11-02T00:00:00Z' }),
    pr(2, { isDraft: true }),
    pr(4, { isCrossRepository: true }),
    pr(5, { state: 'CLOSED' }),
    pr(6, { autoMergeEnabledAt: null }),
  ];
  assert.deepStrictEqual(queueOrder(prs).map((p) => p.number), [3, 1]);
});

test('queueOrder: ties break by PR number', () => {
  const t = '2026-11-01T00:00:00Z';
  const prs = [pr(7, { autoMergeEnabledAt: t }), pr(2, { autoMergeEnabledAt: t })];
  assert.deepStrictEqual(queueOrder(prs).map((p) => p.number), [2, 7]);
});

test('planQueue: empty queue does nothing', () => {
  assert.strictEqual(planQueue([]).action, 'none');
});

test('planQueue: updates behind PRs oldest first', () => {
  const plan = planQueue([pr(2), pr(1)]);
  assert.strictEqual(plan.action, 'update');
  assert.deepStrictEqual(plan.candidates.map((p) => p.number), [1, 2]);
});

test('planQueue: does nothing while an up-to-date PR awaits checks or merge', () => {
  for (const checksState of ['PENDING', 'SUCCESS', 'EXPECTED', null]) {
    const plan = planQueue([pr(1, { behindBy: 0, checksState }), pr(2)]);
    assert.strictEqual(plan.action, 'none', String(checksState));
  }
});

test('planQueue: an up-to-date PR with failed checks does not block the queue', () => {
  for (const checksState of ['FAILURE', 'ERROR']) {
    const plan = planQueue([pr(1, { behindBy: 0, checksState }), pr(2)]);
    assert.strictEqual(plan.action, 'update');
    assert.deepStrictEqual(plan.candidates.map((p) => p.number), [2]);
  }
});

test('planQueue: nothing behind means nothing to do', () => {
  assert.strictEqual(planQueue([pr(1, { behindBy: 0, checksState: 'FAILURE' })]).action, 'none');
});

function fakeClient({ conflicts = [] } = {}) {
  const calls = [];
  return {
    calls,
    async updateBranch(p) {
      calls.push(['update', p.number]);
      if (conflicts.includes(p.number)) throw new Error('gh: merge conflict between base and head (HTTP 422)');
    },
    async removeLabel(p) { calls.push(['unlabel', p.number]); },
    async flagConflict(p) { calls.push(['flag', p.number]); },
  };
}

test('runQueue: updates only the oldest PR', async () => {
  const c = fakeClient();
  const r = await runQueue([pr(2), pr(1)], c);
  assert.strictEqual(r.updated, 1);
  assert.deepStrictEqual(c.calls, [['update', 1]]);
});

test('runQueue: conflict flags the PR and moves to the next', async () => {
  const c = fakeClient({ conflicts: [1] });
  const r = await runQueue([pr(1), pr(2)], c);
  assert.deepStrictEqual(c.calls, [['update', 1], ['flag', 1], ['update', 2]]);
  assert.deepStrictEqual(r.conflicts, [1]);
  assert.strictEqual(r.updated, 2);
});

test('runQueue: all conflicting updates nothing', async () => {
  const c = fakeClient({ conflicts: [1, 2] });
  const r = await runQueue([pr(1), pr(2)], c);
  assert.strictEqual(r.updated, null);
  assert.deepStrictEqual(r.conflicts, [1, 2]);
});

test('runQueue: non-conflict errors propagate', async () => {
  const c = fakeClient();
  c.updateBranch = async () => { throw new Error('HTTP 403'); };
  await assert.rejects(runQueue([pr(1)], c), /403/);
});

test('runQueue: success clears the conflict label', async () => {
  const c = fakeClient();
  await runQueue([pr(1, { labels: [LABEL] })], c);
  assert.deepStrictEqual(c.calls, [['update', 1], ['unlabel', 1]]);
});

test('runQueue: dry run never calls the client', async () => {
  const c = fakeClient();
  const logs = [];
  const r = await runQueue([pr(2), pr(1)], c, { dryRun: true, log: (m) => logs.push(m) });
  assert.deepStrictEqual(c.calls, []);
  assert.strictEqual(r.updated, 1);
  assert.ok(logs.some((m) => m.includes('would update PR #1')));
});
