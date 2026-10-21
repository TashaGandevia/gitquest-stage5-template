import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARRIVALS_PATH, DEPARTURES_PATH } from '../lib/config.mjs';
import { inspectFaultFix, inspectPullRequest, linksIssue, passed } from '../lib/mission.mjs';

const step1 = { step: 1, issues: { task1: 1 } };
const step2 = { step: 2, issues: { task1: 1, task2: 3 } };

function kestrelPr(overrides = {}) {
  return {
    body: 'Closes #1',
    files: { [DEPARTURES_PATH]: '# Departure Records\n\nWren | Departed | 08:40\nKestrel | Departed | 09:15\n' },
    changedPaths: [DEPARTURES_PATH],
    committerEmails: ['learner@example.com'],
    containsTransmission: true,
    ...overrides,
  };
}

const failures = (findings) => findings.filter((f) => !f.ok).map((f) => f.text);

test('linksIssue accepts GitHub closing keywords only for that number', () => {
  assert.ok(linksIssue('Closes #1', 1));
  assert.ok(linksIssue('this fixes #12.', 12));
  assert.ok(linksIssue('Resolved #4', 4));
  assert.ok(!linksIssue('Closes #12', 1));
  assert.ok(!linksIssue('See #1', 1));
  assert.ok(!linksIssue(null, 1));
});

test('step 1 passes a correct Kestrel pull request', () => {
  assert.ok(passed(inspectPullRequest(step1, kestrelPr())));
});

test('step 1 flags a missing link, protected paths and web commits', () => {
  const findings = inspectPullRequest(step1, kestrelPr({
    body: 'Closes #',
    changedPaths: [DEPARTURES_PATH, '.github/workflows/station-control.yml'],
    committerEmails: ['learner@example.com', 'noreply@github.com'],
  }));
  const text = failures(findings).join('\n');
  assert.match(text, /Closes #1/);
  assert.match(text, /station-control\.yml/);
  assert.match(text, /made on GitHub/);
});

test('step 1 requires Wren to stay in the log', () => {
  const findings = inspectPullRequest(step1, kestrelPr({
    files: { [DEPARTURES_PATH]: '# Departure Records\n\nKestrel | Departed | 09:15\n' },
  }));
  assert.deepEqual(failures(findings), ["Wren's departure is still in the log"]);
});

test('step 2 requires the transmission and the replaced Osprey line', () => {
  const pr = kestrelPr({
    body: 'Fixes #3',
    files: { [ARRIVALS_PATH]: 'Osprey | Inbound | 10:30\nOsprey | Docked | 10:42\n' },
    containsTransmission: false,
  });
  const text = failures(inspectPullRequest(step2, pr)).join('\n');
  assert.match(text, /missing station control's latest change/);
  assert.match(text, /old `Inbound` line/);

  pr.files[ARRIVALS_PATH] = 'Osprey | Docked | 10:42\n';
  pr.containsTransmission = true;
  assert.ok(passed(inspectPullRequest(step2, pr)));
});

test('steps without a pull request task return null', () => {
  assert.equal(inspectPullRequest({ step: 3, issues: {} }, kestrelPr()), null);
});

test('step 4 checks the fault line, Fixes keyword and committer', () => {
  const progress = { step: 4, issues: { fault: 9 } };
  const good = {
    faults: '# Fault Records\n\n#9 | Heron | Docking clamp | Resolved\n',
    messages: ['Merge remote main', 'Resolve Heron clamp\n\nFixes #9'],
    headCommitterEmail: 'learner@example.com',
  };
  assert.ok(passed(inspectFaultFix(progress, good)));
  const bad = inspectFaultFix(progress, { faults: '#9 | Heron | Docking clamp | Open', messages: ['done'], headCommitterEmail: 'noreply@github.com' });
  assert.equal(failures(bad).length, 3);
});
