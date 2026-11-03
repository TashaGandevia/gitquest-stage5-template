import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ARRIVALS_PATH, HANDOVER_PATH, PLAN_PATH, REPORT_PATH } from '../lib/config.mjs';
import { ASTER_ARRIVAL, ROUGH_HANDOVER, bayReport } from '../lib/content.mjs';
import {
  STEP,
  allFindings,
  blocking,
  checksPassed,
  evaluatePullRequest,
  inspectDiscrepancy,
  linksIssue,
  logFindings,
  namesReleaseTime,
  passed,
} from '../lib/story.mjs';

const starter = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const failures = (findings) => findings.filter((f) => !f.ok && f.kind !== 'advice').map((f) => f.id);

const plan = { step: STEP.PLAN, steps: { '14.2': 1 }, issues: {}, prs: {}, review: {} };
const handover = { step: STEP.HANDOVER, steps: { '14.2': 1, '15.1': 3 }, issues: {}, prs: { plan: 2 }, review: {} };
const withDiscrepancy = { ...handover, issues: { ...handover.issues, discrepancy: 5 } };
const final = { step: STEP.FINAL, steps: { '14.2': 1, '15.1': 3, '16.3': 9 }, issues: { discrepancy: 5 }, prs: { plan: 2, handover: 4, review: 7 }, review: { corrected: 'abc' } };

function proposal(path, text, overrides = {}) {
  return {
    number: 10,
    isBot: false,
    body: '',
    files: { [path]: text },
    changedPaths: [path],
    committerEmails: ['learner@example.com'],
    transmissions: { 0: true, 1: true },
    ...overrides,
  };
}

const night = (block) => starter(HANDOVER_PATH).replace('<!-- Tonight\'s handover goes here. -->', block);

test('linksIssue accepts closing keywords for that number only', () => {
  assert.ok(linksIssue('Closes #1', 1));
  assert.ok(linksIssue('Fixes: #12', 12));
  assert.ok(!linksIssue('Closes #12', 1));
  assert.ok(!linksIssue('See #1', 1));
  assert.ok(!linksIssue('Closes #1', undefined));
});

test('M14: the revised plan passes and Mika\'s condition must stay', () => {
  const revised = starter(PLAN_PATH).replace('Expected: 20:10', 'Expected: 22:40');
  const good = evaluatePullRequest(plan, proposal(PLAN_PATH, revised, { body: 'Closes #1' }));
  assert.ok(passed(allFindings(good)), logFindings(allFindings(good)));
  assert.deepEqual(good.parts.map((p) => p.title), ['Validate arrival plan', 'Validate links and paths']);

  const bad = revised.replace('Status: Planned', 'Status: Docked').replace(/Condition: .*/, 'Condition: none');
  assert.deepEqual(failures(allFindings(evaluatePullRequest(plan, proposal(PLAN_PATH, bad, { body: 'Closes #1' })))), ['plan-status', 'plan-condition']);
});

test('M14: a missing closing link fails the check but does not block the merge', () => {
  const revised = starter(PLAN_PATH).replace('Expected: 20:10', 'Expected: 22:40');
  const findings = allFindings(evaluatePullRequest(plan, proposal(PLAN_PATH, revised, { body: 'See #1' })));
  assert.deepEqual(failures(findings), ['proposal-link']);
  assert.deepEqual(blocking(findings), []);
});

test('M14: station equipment and extra files are refused', () => {
  const revised = starter(PLAN_PATH).replace('Expected: 20:10', 'Expected: 22:40');
  const findings = allFindings(evaluatePullRequest(plan, proposal(PLAN_PATH, revised, {
    body: 'Closes #1',
    changedPaths: [PLAN_PATH, 'docking-log/notices/maintenance-2085-12-08.md', ARRIVALS_PATH],
  })));
  assert.deepEqual(failures(findings), ['proposal-protected', 'proposal-paths']);
});

test('M15: Mika\'s rough draft fails with the exact handover-time diagnostic', () => {
  const evaluation = evaluatePullRequest(handover, proposal(HANDOVER_PATH, night(ROUGH_HANDOVER), { body: 'Closes #3' }));
  const part = evaluation.parts.find((p) => p.id === 'handover');
  assert.deepEqual(failures(part.findings), ['handover-time']);
  assert.equal(logFindings(part.findings.filter((f) => !f.ok)), [
    'FAIL handover-time',
    'docking-log/handover/2085-12-08.md',
    'Expected: 22.40',
    'Use a 24-hour time in HH:MM form, for example 22:40.',
  ].join('\n'));
  assert.equal(evaluation.readiness.find((f) => f.id === 'readiness-checks').ok, false);
});

test('M15: a green format check still leaves readiness waiting on the review', () => {
  const fixedTime = ROUGH_HANDOVER.replace('22.40', '22:40');
  const evaluation = evaluatePullRequest(handover, proposal(HANDOVER_PATH, night(fixedTime), { body: 'Closes #3' }));
  assert.ok(checksPassed(evaluation));
  assert.deepEqual(failures(evaluation.readiness), ['readiness-instruction', 'readiness-discrepancy']);
});

test('M15: readiness passes with an explicit instruction, a discrepancy and both links', () => {
  const corrected = ROUGH_HANDOVER.replace('22.40', '22:40')
    .replace('Instruction: Prepare Bay 3 for Aster.', 'Instruction: Wait for Maintenance to release Bay 3 before preparing it for Aster.');
  const pr = proposal(HANDOVER_PATH, night(corrected), { body: 'Closes #3\nFixes #5' });
  const evaluation = evaluatePullRequest(withDiscrepancy, pr);
  assert.ok(passed(allFindings(evaluation)), logFindings(allFindings(evaluation)));

  pr.transmissions = { 0: true, 1: false };
  assert.deepEqual(failures(allFindings(evaluatePullRequest(withDiscrepancy, pr))), ['proposal-notice']);
});

test('M15: Bay status must still be Hold', () => {
  const released = ROUGH_HANDOVER.replace('22.40', '22:40').replace('Bay status: Hold', 'Bay status: Released');
  const evaluation = evaluatePullRequest(handover, proposal(HANDOVER_PATH, night(released), { body: 'Closes #3' }));
  assert.deepEqual(failures(evaluation.parts[0].findings), ['handover-bay-status']);
});

test('M15: the discrepancy form needs the file, pull request, sentence and notice', () => {
  const body = [
    '### File', '', 'docking-log/handover/2085-12-08.md', '',
    '### Location', '', 'Instruction field, proposed in PR #4', '',
    '### Observed', '', 'Prepare Bay 3 for Aster.', '',
    '### Expected', '', 'Say that preparation waits for the release.', '',
    '### Evidence', '', 'Maintenance duty note · 18:15 (docking-log/notices/maintenance-2085-12-08.md)', '',
    '### Evidence details', '', '_No response_',
  ].join('\n');
  const good = inspectDiscrepancy(body);
  assert.ok(passed(good.findings));
  assert.equal(good.pullRequest, 4);
  const bad = inspectDiscrepancy(body.replace('PR #4', 'the PR').replace('Prepare Bay 3 for Aster.', 'it is unclear'));
  assert.deepEqual(failures(bad.findings), ['discrepancy-location', 'discrepancy-observed']);
});

test('M16: the bot proposal passes structure checks despite the wrong release time', () => {
  const review = { ...final, step: STEP.REVIEW, prs: { ...final.prs }, issues: { ...withDiscrepancy.issues } };
  const report = bayReport({ discrepancy: 5, handoverPr: 4, releaseTime: '22:40' });
  const evaluation = evaluatePullRequest(review, {
    ...proposal(REPORT_PATH, report, { isBot: true, number: 7, changedPaths: [ARRIVALS_PATH, REPORT_PATH] }),
    files: { [ARRIVALS_PATH]: `${starter(ARRIVALS_PATH)}${ASTER_ARRIVAL}\n`, [REPORT_PATH]: report },
  });
  assert.ok(evaluation.review);
  assert.ok(passed(allFindings(evaluation)), logFindings(allFindings(evaluation)));
  assert.match(evaluation.scope, /do not compare the report with the notices/);
});

test('M16 repair: the release time must agree with the notice', () => {
  const repair = { ...final, step: STEP.REPAIR, steps: { ...final.steps, '16.R': 9 } };
  const files = { [ARRIVALS_PATH]: `${starter(ARRIVALS_PATH)}${ASTER_ARRIVAL}\n`, [REPORT_PATH]: bayReport({ discrepancy: 5, handoverPr: 4, releaseTime: '22:40' }) };
  const pr = { ...proposal(REPORT_PATH, null, { body: 'Closes #9' }), files };
  assert.deepEqual(failures(allFindings(evaluatePullRequest(repair, pr))), ['report-release']);
  files[REPORT_PATH] = bayReport({ discrepancy: 5, handoverPr: 4, releaseTime: '22:25' });
  assert.ok(passed(allFindings(evaluatePullRequest(repair, pr))));
});

test('M16 final: the summary needs both times, both links and outstanding work', () => {
  const block = ROUGH_HANDOVER.replace('22.40', '22:40').replace('Prepare Bay 3 for Aster.', 'Wait for Maintenance to release Bay 3.');
  const summary = `${night(block)}
## Summary

### Outcome

Bay 3 was held. Maintenance released it at 22:25 and Aster docked at 22:40.

### Evidence

See issue #5 and PR #7.

### Outstanding work

None.
`;
  const report = bayReport({ discrepancy: 5, handoverPr: 4, releaseTime: '22:25' });
  const pr = { ...proposal(HANDOVER_PATH, summary, { body: 'Closes #9' }), files: { [HANDOVER_PATH]: summary, [REPORT_PATH]: report } };
  assert.ok(passed(allFindings(evaluatePullRequest(final, pr))), logFindings(allFindings(evaluatePullRequest(final, pr))));

  pr.files[HANDOVER_PATH] = summary.replace('See issue #5 and PR #7.', 'See issue #5.').replace('released it at 22:25', 'released it at 22:40');
  pr.files[REPORT_PATH] = null;
  assert.deepEqual(failures(allFindings(evaluatePullRequest(final, pr))), ['summary-times', 'summary-release', 'summary-evidence', 'proposal-report']);
});

test('steps without a learner task return null', () => {
  assert.equal(evaluatePullRequest({ ...final, step: STEP.REVIEW }, proposal(HANDOVER_PATH, '')), null);
  assert.equal(evaluatePullRequest({ ...final, step: STEP.COMPLETE }, proposal(HANDOVER_PATH, '')), null);
});

test('a review names the evidence when it gives the release time', () => {
  assert.ok(namesReleaseTime('Release should be 22:25, not 22:40'));
  assert.ok(!namesReleaseTime('Looks wrong'));
});
