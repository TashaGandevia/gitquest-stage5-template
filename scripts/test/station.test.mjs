// Plays the whole shift through station.mjs and checks.mjs, as the workflows
// run them, against real Git repositories and a fake GitHub API. Tests run in
// order and share one repository, like a learner working through the stage.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ARRIVALS_PATH, HANDOVER_PATH, MAINTENANCE_NOTICES_PATH, PLAN_PATH, PROGRESS_PATH, REPORT_PATH, REVIEW_BRANCH, TEMPLATE_REPOSITORY } from '../lib/config.mjs';
import { ROUGH_HANDOVER } from '../lib/content.mjs';
import { initialProgress } from '../lib/story.mjs';
import { startFakeGitHub } from './fake-github.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO = 'learner/docking-log';
const LEARNER = { GIT_COMMITTER_NAME: 'Learner', GIT_COMMITTER_EMAIL: 'learner@example.com' };
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Learner',
  GIT_AUTHOR_EMAIL: 'learner@example.com',
  GIT_COMMITTER_NAME: 'Station',
  GIT_COMMITTER_EMAIL: 'station@example.com',
};
const starter = (path) => readFileSync(join(ROOT, path), 'utf8');
const STARTER_FILES = Object.fromEntries([ARRIVALS_PATH, PLAN_PATH, HANDOVER_PATH, MAINTENANCE_NOTICES_PATH, 'README.md']
  .map((path) => [path, starter(path)]));

let root, api, origin, learner, station;
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...GIT_ENV, ...env }, encoding: 'utf8' }).trim();

function write(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

function commit(cwd, path, content, message, env = LEARNER) {
  write(cwd, path, content);
  git(cwd, ['add', path]);
  git(cwd, ['commit', '-q', '-m', message], env);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function run(script, args, eventName, event) {
  rmSync(station, { recursive: true, force: true });
  git(root, ['clone', '-q', origin, station]);
  const eventPath = join(root, `event-${Math.random()}.json`);
  const summary = join(root, `summary-${Math.random()}.md`);
  writeFileSync(eventPath, JSON.stringify(event));
  writeFileSync(summary, '');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script), ...args], {
      cwd: station,
      env: {
        ...GIT_ENV,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_REPOSITORY: REPO,
        GITHUB_TOKEN: 'test-token',
        GITHUB_API_URL: api.url,
        GITHUB_RUN_ID: '99',
        GITHUB_STEP_SUMMARY: summary,
        RUNNER_TEMP: root,
      },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code, output, summary: readFileSync(summary, 'utf8') }));
  });
}

const station_ = (eventName, event) => run('station.mjs', [], eventName, { sender: { type: 'User', login: 'learner' }, ...event });

// The Record checks workflow: gather, each validate step, then report.
async function recordChecks(eventName, event) {
  const steps = {};
  steps.gather = await run('checks.mjs', ['gather'], eventName, event);
  for (const part of ['plan', 'handover', 'records', 'proposal']) {
    steps[part] = await run('checks.mjs', ['validate', part], eventName, event);
  }
  steps.report = await run('checks.mjs', ['report'], eventName, event);
  return steps;
}

const progress = () => JSON.parse(api.state.snapshots[api.state.branches.main][PROGRESS_PATH]);
const comments = (n) => (api.state.comments[n] ?? []).map((c) => c.body);
const lastStationCommit = () => api.state.stationCommits.at(-1);
const issueNumbers = () => api.state.issues.map((i) => i.number);

// A learner pull request: pushes `head` to refs/pull/<n>/head and registers it.
function openPullRequest(number, branch, head, body) {
  git(learner, ['push', '-q', '-f', 'origin', `${head}:refs/pull/${number}/head`]);
  const base = git(learner, ['rev-parse', 'origin/main']);
  const existing = api.state.pulls.find((p) => p.number === number);
  const pr = { number, body, state: 'open', merged: false, user: { type: 'User', login: 'learner' }, head: { ref: branch, sha: head }, base: { ref: 'main', sha: base } };
  if (existing) Object.assign(existing, pr);
  else {
    api.state.pulls.push(pr);
    api.state.next = Math.max(api.state.next, number + 1);
  }
  return pr;
}

// Merges on the real origin, as GitHub's merge button would.
function merge(pr, transmission) {
  git(learner, ['checkout', '-q', 'main']);
  git(learner, ['pull', '-q', 'origin', 'main']);
  git(learner, ['merge', '-q', '--no-ff', '-m', `Merge pull request #${pr.number}`, pr.head.sha]);
  if (transmission) commit(learner, 'docking-log/.station', transmission, transmission, {});
  git(learner, ['push', '-q', 'origin', 'main']);
  const mergeSha = git(learner, ['rev-parse', 'HEAD']);
  Object.assign(pr, { state: 'closed', merged: true, merged_at: 'now', merge_commit_sha: api.state.branches.main });
  return mergeSha;
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'station-test-'));
  api = await startFakeGitHub({ repository: REPO, files: { ...STARTER_FILES, [PROGRESS_PATH]: JSON.stringify(initialProgress()) } });
  origin = join(root, 'origin.git');
  learner = join(root, 'learner');
  station = join(root, 'station');
  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, ['clone', '-q', origin, learner]);
  git(learner, ['checkout', '-q', '-b', 'main']);
  for (const [path, text] of Object.entries(STARTER_FILES)) write(learner, path, text);
  git(learner, ['add', '.']);
  git(learner, ['commit', '-q', '-m', 'Initial commit']);
  commit(learner, '.gitquest/marker', 'T0', '[station] T0: shift pack opened', {});
  git(learner, ['push', '-q', 'origin', 'main']);
});

after(() => {
  api?.server.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

const issueByNumber = (n) => api.state.issues.find((i) => i.number === n);
const step = (key) => progress().steps[key];
const stepIssueOf = (key) => issueByNumber(step(key));
// A finished step is confirmed by a character on its own issue.
const confirmedOn = (key) => comments(step(key)).find((c) => c.includes(`gitquest:confirm-${key}`));
const nextNumber = () => api.state.next;
const pullRequestEvent = (action, pr) => ({ action, sender: { type: 'User', login: 'learner' }, pull_request: pr });

test('Run workflow opens M14.1, and a second run adds nothing', async () => {
  const first = await station_('workflow_dispatch', {});
  assert.equal(first.code, 0, first.output);
  assert.deepEqual(api.state.labels, ['task', 'record-discrepancy', 'station']);
  const issue = issueByNumber(1);
  assert.equal(issue.title, 'M14.1 · Take the request');
  assert.match(issue.body, /<table>\n<tr>\n<td>\n\n\$\\color\{#CBBD6A\}\{\\Large\\textbf\{Mika\}\}\$\n\n[\s\S]*Put your name on it first[\s\S]*<\/td>/, 'a card with Mika\'s name in her colour');
  assert.doesNotMatch(issue.body, /\[HTML\]/, 'only the #RRGGBB colour form renders on GitHub');
  assert.match(issue.body, /this one is \*\*#1\*\*/, 'the issue shows its own number');
  assert.match(issue.body, /# Comms[\s\S]*# Your Tasks\n\n## Task 1\n\n- \[ \] \*\*Assign yourself\*\*[\s\S]*prevent overlap and wasted work/);
  assert.match(issue.body, /\*\*task list\*\*/);
  assert.match(issue.body, /\[SCREENSHOT\]: The issue sidebar[^\n]*\n\n!\[[^\]]*\]\(https:\/\/raw\.githubusercontent\.com\/learner\/docking-log\/main\/\.github\/screenshots\/m14-1-issue-sidebar-assignees-open\.png\)/, 'the image loads from the player\'s own copy');
  assert.doesNotMatch(issue.body, /\{\{screenshots\}\}|\{\{issue\}\}/);
  assert.match(issue.body, /git switch -c aster-plan[\s\S]*git push -u origin aster-plan[\s\S]*has no upstream branch/, 'M14.1 is real work: branch, commit, push -u');
  assert.match(issue.body, /How did this issue get here\?[\s\S]*Run workflow/);
  assert.equal(progress().chunk, '14.1');
  const readme = api.state.snapshots[api.state.branches.main]['README.md'];
  assert.match(readme, /m14-on-the-other-end-locked\.svg/, 'badges start locked');
  assert.match(readme, /## Your shift[\s\S]*\| M14\.1 · Take the request \| \*\*Current:\*\* \[#1\]\(\.\.\/\.\.\/issues\/1\) \|/);
  assert.match(readme, /\| M14\.2 · Open a pull request \| Up next \|/);
  assert.match(first.summary, /Your first task is \[M14\.1 · Take the request\]\(https:\/\/github.com\/learner\/docking-log\/issues\/1\)/);

  await station_('workflow_dispatch', {});
  assert.deepEqual(issueNumbers(), [1]);
});

let planPr;

test('M14.1 → M14.2: pushing the branch is confirmed by Mika, who links the pull request task', async () => {
  git(learner, ['switch', '-q', '-c', 'aster-plan']);
  const head = commit(learner, PLAN_PATH, starter(PLAN_PATH).replace('Expected: 20:10', 'Expected: 22:40'), 'Update Aster expected arrival');
  git(learner, ['push', '-q', '-u', 'origin', 'aster-plan']);
  const { code, output } = await station_('push', { ref: 'refs/heads/aster-plan', after: head });
  assert.equal(code, 0, output);
  const note = confirmedOn('14.1');
  assert.match(note, /textbf\{Mika\}[\s\S]*I can see `aster-plan` on GitHub/);
  assert.match(note, /your name isn't on the job yet/, 'a nudge when the player never assigned themselves');
  assert.match(note, /then close this issue/);
  assert.match(note, /@learner/);
  assert.equal(issueByNumber(1).state, 'open', 'the player closes it, not station control');
  const pull = stepIssueOf('14.2');
  assert.equal(pull.title, 'M14.2 · Open a pull request');
  assert.match(pull.body, new RegExp(`\`Closes #${pull.number}\``), 'the issue names itself as the one to close');
  assert.match(pull.body, /Leave this issue open/);
});

test('M14.2 → M14.3: opening the pull request moves on; Record checks passes by itself', async () => {
  const closes = step('14.2');
  planPr = openPullRequest(nextNumber(), 'aster-plan', git(learner, ['rev-parse', 'HEAD']), `Aster is now expected at 22:40.\n\nCloses #${closes}`);
  await station_('pull_request', pullRequestEvent('opened', planPr));
  assert.match(confirmedOn('14.2'), /Leave this issue open: it closes by itself/);
  const merge14 = stepIssueOf('14.3');
  assert.match(merge14.body, /\*\*Nothing to do here\*\*/);
  assert.match(merge14.body, /Delete branch[\s\S]*safe/);
  assert.match(comments(planPr.number).at(-1), /Next step:\*\* M14\.3 · Check and merge/);
  const wait = comments(planPr.number).find((c) => c.includes('gitquest:wait'));
  assert.match(wait, /> \[!WARNING\]\n> \*\*Don't merge yet\.\*\*[\s\S]*not a check of your record/, 'a wait note arrives before any result');

  const steps = await recordChecks('pull_request', pullRequestEvent('opened', planPr));
  assert.equal(steps.plan.code, 0, steps.plan.output);
  assert.equal(steps.proposal.code, 0, steps.proposal.output);
  assert.ok(comments(planPr.number).some((c) => /\*\*Passed\.\*\*/.test(c)));
  assert.ok(comments(planPr.number).some((c) => /Ready to merge/.test(c)));
});

test('M14 → M15: merging is confirmed by Voss and opens M15.1 with the hold notice', async () => {
  merge(planPr, '[station] T1: Maintenance hold on Bay 3');
  const { code, output } = await station_('pull_request', pullRequestEvent('closed', planPr));
  assert.equal(code, 0, output);
  const readme = api.state.snapshots[api.state.branches.main]['README.md'];
  assert.match(readme, /m14-on-the-other-end-earned\.svg/, 'the M14 badge is earned once M14 is done');
  assert.match(readme, /m15-read-the-result-locked\.svg/);
  assert.match(readme, /\| M14\.3 · Check and merge \| Done \(\[#\d+\]/);
  assert.match(confirmedOn('14.3'), /color\{#D99D5B\}\{\\Large\\textbf\{Voss\}\}[\s\S]*That finishes M14[\s\S]*Your next task: #\d+ · \*\*M15\.1/);
  const notice = api.state.stationCommits.find((c) => c.message.startsWith('[station] T1: '));
  assert.match(notice.files[MAINTENANCE_NOTICES_PATH], /## 18:15 · Maintenance duty note/);
  assert.equal(progress().step, 2);
  assert.match(stepIssueOf('15.1').body, /textbf\{Maintenance\}[\s\S]*guide-light test is incomplete/);
  assert.match(stepIssueOf('15.1').body, /- \[ \] \*\*Wait for Record checks\. Don't merge\*\*/);
});

let handoverPr;

test('M15.1 → M15.2: Mika\'s draft fails Validate handover with a readable diagnostic', async () => {
  git(learner, ['switch', '-q', '-c', 'night-handover', 'origin/main']);
  const draft = starter(HANDOVER_PATH).replace('<!-- Tonight\'s handover goes here. -->', ROUGH_HANDOVER);
  const head = commit(learner, HANDOVER_PATH, draft, 'Add night-shift handover');
  handoverPr = openPullRequest(nextNumber(), 'night-handover', head, `Closes #${step('15.1')}`);
  await station_('pull_request', pullRequestEvent('opened', handoverPr));
  assert.equal(progress().chunk, '15.2');
  assert.match(stepIssueOf('15.2').body, new RegExp(`problem in pull request #${handoverPr.number}`));

  const steps = await recordChecks('pull_request', pullRequestEvent('opened', handoverPr));
  assert.equal(steps.handover.code, 1);
  assert.match(steps.handover.output, /FAIL handover-time\ndocking-log\/handover\/2085-12-08.md\nExpected: 22.40\nUse a 24-hour time in HH:MM form, for example 22:40\./);
  const report = comments(handoverPr.number).find((c) => c.includes('gitquest:inspection'));
  assert.match(report, /> \[!CAUTION\]\n> \*\*Must be fixed before this merges\*\*\n>\n> - \$\\color\{#FF8E98\}\{\\textbf\{FAIL\}\}\$ · Expected time/, 'errors go in the red Caution box, in the error colour');
  assert.ok(comments(handoverPr.number).some((c) => /textbf\{Voss\}[\s\S]*Open its details/.test(c)));
});

test('M15.2 → M15.3: a fixed time turns the check green and Mika asks for a discrepancy', async () => {
  const fixed = readFileSync(join(learner, HANDOVER_PATH), 'utf8').replace('22.40', '22:40');
  const head = commit(learner, HANDOVER_PATH, fixed, 'Fix handover time format');
  handoverPr = openPullRequest(handoverPr.number, 'night-handover', head, handoverPr.body);
  await station_('pull_request', pullRequestEvent('synchronize', handoverPr));
  assert.equal(progress().chunk, '15.3');
  assert.match(confirmedOn('15.2'), new RegExp(`Record checks\\*\\* is green on #${handoverPr.number}`));
  assert.match(stepIssueOf('15.3').body, new RegExp(`Instruction field, PR #${handoverPr.number}`));

  const steps = await recordChecks('pull_request', pullRequestEvent('synchronize', handoverPr));
  assert.equal(steps.handover.code, 0, steps.handover.output);
  assert.ok(comments(handoverPr.number).some((c) => /The format's right/.test(c)));
});

let discrepancy;

test('M15.3 → M15.4: the discrepancy gets feedback, then is recorded once edited', async () => {
  const form = (location) => [
    '### File', '', 'docking-log/handover/2085-12-08.md', '',
    '### Location', '', location, '',
    '### Observed', '', 'Prepare Bay 3 for Aster.', '',
    '### Expected', '', 'Make it clear the bay stays on hold until Maintenance releases it.', '',
    '### Evidence', '', 'Maintenance duty note · 18:15 (docking-log/notices/maintenance-2085-12-08.md)', '',
    '### Evidence details', '', '_No response_',
  ].join('\n');
  discrepancy = nextNumber();
  const issue = { id: 1, number: discrepancy, title: 'Record discrepancy: Bay 3 instruction', body: form('Instruction field'), labels: [{ name: 'record-discrepancy' }], state: 'open', user: { type: 'User' } };
  api.state.issues.push(issue);
  api.state.next += 1;

  await station_('issues', { action: 'opened', issue });
  assert.equal(progress().issues.discrepancy, undefined);
  assert.match(comments(discrepancy)[0], /name the field and the pull request/);

  issue.body = form(`Instruction field, proposed in PR #${handoverPr.number}`);
  const { code, output } = await station_('issues', { action: 'edited', issue });
  assert.equal(code, 0, output);
  assert.equal(progress().issues.discrepancy, discrepancy);
  assert.equal(progress().chunk, '15.4');
  assert.match(confirmedOn('15.3'), new RegExp(`Discrepancy #${discrepancy} is on record`));
  assert.match(stepIssueOf('15.4').body, new RegExp(`add \`Fixes #${discrepancy}\``));
});

test('M15.4: the corrected instruction and both links make the handover ready', async () => {
  const corrected = readFileSync(join(learner, HANDOVER_PATH), 'utf8')
    .replace('Instruction: Prepare Bay 3 for Aster.', 'Instruction: Wait for Maintenance to release Bay 3 before preparing it for Aster.');
  const head = commit(learner, HANDOVER_PATH, corrected, 'Make the Bay 3 hold explicit');
  handoverPr = openPullRequest(handoverPr.number, 'night-handover', head, `Closes #${step('15.1')}\nFixes #${discrepancy}`);
  await station_('pull_request', pullRequestEvent('synchronize', handoverPr));
  const steps = await recordChecks('pull_request', pullRequestEvent('synchronize', handoverPr));
  assert.equal(steps.handover.code, 0);
  const readiness = api.state.statuses.filter((s) => s.context === 'Handover readiness').at(-1);
  assert.equal(readiness.state, 'success');
});

let reviewPr;

test('M15 → M16: merging opens Mika\'s pull request and M16.1', async () => {
  merge(handoverPr);
  const { code, output } = await station_('pull_request', pullRequestEvent('closed', handoverPr));
  assert.equal(code, 0, output);
  reviewPr = api.state.pulls.find((p) => p.head.ref === REVIEW_BRANCH);
  assert.match(api.state.snapshots[api.state.branches[REVIEW_BRANCH]][REPORT_PATH], /Maintenance released Bay 3 at 22:40\./);
  assert.match(confirmedOn('15.4'), /That finishes M15/);
  assert.equal(progress().chunk, '16.1');
  assert.match(stepIssueOf('16.1').body, new RegExp(`pull request #${reviewPr.number}`));
  assert.match(comments(handoverPr.number).at(-1), /Next step:\*\* M16\.1/);
});

test('M16.1: approving the faulty revision gets the evidence, not a merge', async () => {
  api.state.reviews[reviewPr.number] = [{ id: 1, state: 'APPROVED', commit_id: reviewPr.head.sha, body: 'LGTM' }];
  await station_('pull_request_review', { action: 'submitted', pull_request: reviewPr, review: { id: 1, state: 'approved', commit_id: reviewPr.head.sha, body: 'LGTM' } });
  assert.match(comments(reviewPr.number).at(-1), /released at \*\*22:25\*\*/);
  assert.equal(progress().chunk, '16.1');
});

test('M16.1 → M16.2: Request changes naming 22:25 makes Mika push a correction', async () => {
  api.state.reviewComments[2] = [{ body: "Maintenance's notice records release at 22:25." }];
  await station_('pull_request_review', { action: 'submitted', pull_request: reviewPr, review: { id: 2, state: 'changes_requested', commit_id: reviewPr.head.sha, body: '' } });
  const correction = api.state.stationCommits.find((c) => c.message.startsWith('[station] T6: '));
  assert.match(correction.files[REPORT_PATH], /Maintenance released Bay 3 at 22:25\./);
  assert.equal(progress().chunk, '16.2');
  assert.match(confirmedOn('16.1'), /Thanks for checking the notice/);
});

test('M16.2 → M16.3: approving and merging the correction opens the final handover', async () => {
  const corrected = progress().review.corrected;
  api.state.reviews[reviewPr.number].push({ id: 3, state: 'APPROVED', commit_id: corrected });
  await station_('pull_request_review', { action: 'submitted', pull_request: reviewPr, review: { id: 3, state: 'approved', commit_id: corrected } });
  reviewPr.head.sha = corrected;
  Object.assign(reviewPr, { state: 'closed', merged: true, merge_commit_sha: api.state.branches[REVIEW_BRANCH] });
  await station_('pull_request', pullRequestEvent('closed', reviewPr));
  assert.equal(progress().step, 5);
  const final = stepIssueOf('16.3');
  assert.match(final.body, new RegExp(`link #${discrepancy} and #${reviewPr.number}`));
  assert.match(final.body, new RegExp(`Closes #${final.number}`));
});

test('M16.3 → M16.4 → complete: the final handover finishes the stage', async () => {
  git(learner, ['switch', '-q', '-c', 'final-handover', 'origin/main']);
  const summary = `${readFileSync(join(learner, HANDOVER_PATH), 'utf8')}
## Summary

### Outcome

Bay 3 was held. Maintenance released it at 22:25 and Aster docked at 22:40.

### Evidence

Discrepancy #${discrepancy}; arrival and corrected report in PR #${reviewPr.number}.

### Outstanding work

None.
`;
  const head = commit(learner, HANDOVER_PATH, summary, 'Finish the December 8 handover');
  const pr = openPullRequest(nextNumber(), 'final-handover', head, `Closes #${step('16.3')}`);
  await station_('pull_request', pullRequestEvent('opened', pr));
  assert.equal(progress().chunk, '16.4');
  const steps = await recordChecks('pull_request', pullRequestEvent('opened', pr));
  assert.equal(steps.handover.code, 0, steps.handover.output);

  merge(pr);
  const { code, output } = await station_('pull_request', pullRequestEvent('closed', pr));
  assert.equal(code, 0, output);
  assert.equal(progress().complete, true);
  assert.match(confirmedOn('16.4'), /That finishes M16/);
  assert.match(comments(step('16.4')).at(-1), /Relief's here[\s\S]*Stage complete/);

  // The one-time GitQuest code: in completion.json, in the Shift report issue and the README.
  const t9 = api.state.stationCommits.find((c) => c.message.startsWith('[station] T9: '));
  const json = JSON.parse(t9.files['.gitquest/completion.json']);
  assert.match(json.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/, '12 characters, no look-alikes');
  assert.equal(json.repository, 'learner/docking-log');
  assert.deepEqual(json.badges, ['m14-on-the-other-end', 'm15-read-the-result', 'm16-second-pair-of-eyes']);
  const report = api.state.issues.find((i) => i.title === 'Shift report · Your GitQuest code');
  assert.match(report.body, new RegExp(`\`\`\`text\\n${json.code}\\n\`\`\``));
  assert.match(report.body, new RegExp(`redeem\\?repo=learner%2Fdocking-log&code=${json.code}`));
  assert.match(report.body, /works \*\*once\*\*/);
  assert.match(comments(step('16.4')).at(-1), new RegExp(`your GitQuest code is in #${report.number}`));
  const readme = t9.files['README.md'];
  for (const id of json.badges) assert.match(readme, new RegExp(`${id}-earned\\.svg`));
  assert.match(readme, new RegExp(`Shift complete\\.\\*\\* Your GitQuest code is in \\[#${report.number}\\]`));
  assert.equal(progress().completion.code, json.code);
  const done = api.state.stationCommits.find((c) => c.message.startsWith('[station] T9: '));
  assert.match(done.files['.gitquest/completion.md'], /M14\.1 task \| \[#1\]/);
});

// Puts the story back at M14.2 for the recovery tests; returns a restore function.
function rewindToM14() {
  const saved = api.state.snapshots[api.state.branches.main][PROGRESS_PATH];
  api.state.snapshots[api.state.branches.main][PROGRESS_PATH] = JSON.stringify({ ...progress(), step: 1, chunk: '14.2', complete: false });
  return () => { api.state.snapshots[api.state.branches.main][PROGRESS_PATH] = saved; };
}

test('a direct push to main is undone, and Voss gives a do-this-instead checklist', async () => {
  const restore = rewindToM14();
  git(learner, ['switch', '-q', 'main']);
  git(learner, ['pull', '-q', 'origin', 'main']);
  const before = git(learner, ['rev-parse', 'HEAD']);
  const planBefore = readFileSync(join(learner, PLAN_PATH), 'utf8');
  const after = commit(learner, PLAN_PATH, planBefore.replace(/Expected: .*/, 'Expected: 23:59'), 'Edit the plan on main');
  git(learner, ['push', '-q', 'origin', 'main']);
  const { code, output } = await station_('push', { ref: 'refs/heads/main', before, after });
  assert.equal(code, 0, output);
  const undo = lastStationCommit();
  assert.match(undo.message, /^\[station\] T12: undo a direct push to main/);
  assert.equal(undo.files[PLAN_PATH], planBefore);
  const note = comments(step('14.2')).at(-1);
  assert.match(note, /That went straight onto `main`[\s\S]*> \[!WARNING\]\n> \*\*Your push to `main` was undone\.\*\*[\s\S]*#### Do this instead[\s\S]*aster-plan-2[\s\S]*`Closes #\d+`/);
  restore();
});

test('a push to main from merging a pull request is left alone', async () => {
  const restore = rewindToM14();
  const before = git(learner, ['rev-parse', 'HEAD']);
  const after = commit(learner, PLAN_PATH, readFileSync(join(learner, PLAN_PATH), 'utf8').replace(/Expected: .*/, 'Expected: 22:40'), 'Merge pull request #99');
  git(learner, ['push', '-q', 'origin', 'main']);
  api.state.pulls.push({ number: 99, state: 'closed', merged: true, merged_at: 'now', mergeSha: after, user: { type: 'User' }, head: { ref: 'x', sha: after }, base: { ref: 'main', sha: before }, body: '' });
  const commits = api.state.stationCommits.length;
  const { code, output } = await station_('push', { ref: 'refs/heads/main', before, after });
  assert.equal(code, 0, output);
  assert.equal(api.state.stationCommits.length, commits, 'nothing undone');
  restore();
});

test('a pull request merged with the wrong record gets Voss and a checklist', async () => {
  const restore = rewindToM14();
  git(learner, ['switch', '-q', '-c', 'bad-plan', 'origin/main']);
  const head = commit(learner, PLAN_PATH, readFileSync(join(learner, PLAN_PATH), 'utf8').replace(/Expected: .*/, 'Expected: 21:00'), 'Wrong time');
  const pr = openPullRequest(nextNumber(), 'bad-plan', head, `Closes #${step('14.2')}`);
  merge(pr);
  const { code, output } = await station_('pull_request', pullRequestEvent('closed', pr));
  assert.equal(code, 0, output);
  const note = comments(pr.number).at(-1);
  assert.match(note, /merged before the record was right[\s\S]*> \[!CAUTION\]\n> \*\*What needs fixing\*\*[\s\S]*Expected time should be 22:40[\s\S]*Do this instead/);
  restore();
});

test('a GitHub Revert pull request gets "fix forward" advice, and merging it is not a bad merge', async () => {
  const restore = rewindToM14();
  const bad = api.state.pulls.find((p) => p.head.ref === 'bad-plan');
  git(learner, ['switch', '-q', '-c', `revert-${bad.number}-bad-plan`, 'origin/main']);
  git(learner, ['revert', '--no-edit', '-m', '1', 'HEAD'], LEARNER);
  const head = git(learner, ['rev-parse', 'HEAD']);
  const pr = openPullRequest(nextNumber(), `revert-${bad.number}-bad-plan`, head, `Reverts learner/docking-log#${bad.number}`);

  await station_('pull_request', pullRequestEvent('opened', pr));
  const advice = comments(pr.number).find((c) => c.includes('gitquest:revert'));
  assert.match(advice, new RegExp(`This would undo #${bad.number}[\\s\\S]*fix forward[\\s\\S]*\\[!WARNING\\][\\s\\S]*#### Do this instead`));

  const steps = await recordChecks('pull_request', pullRequestEvent('opened', pr));
  assert.equal(steps.plan.code, 0, 'a revert is not inspected as a task');
  assert.equal(steps.proposal.code, 0);
  assert.match(comments(pr.number).find((c) => c.includes('gitquest:inspection')), new RegExp(`undoes #${bad.number}, so it isn't inspected`));

  merge(pr);
  const { code, output } = await station_('pull_request', pullRequestEvent('closed', pr));
  assert.equal(code, 0, output);
  const notes = comments(pr.number);
  assert.ok(notes.some((c) => c.includes('gitquest:revert-merged')));
  assert.ok(!notes.some((c) => /merged before the record was right/.test(c)), 'a revert is not treated as a bad handover');
  assert.ok(progress().handled.includes(pr.number));
  restore();
});

test('a merge whose run was lost is finished by the next run', async () => {
  const restore = rewindToM14();
  git(learner, ['switch', '-q', '-c', 'late-plan', 'origin/main']);
  const plan = readFileSync(join(learner, PLAN_PATH), 'utf8');
  const head = commit(learner, PLAN_PATH, plan.includes('Expected: 22:40') ? plan.replace('Status: Planned', 'Status: Planned ') : plan.replace(/Expected: .*/, 'Expected: 22:40'), 'Update Aster expected arrival');
  const pr = openPullRequest(nextNumber(), 'late-plan', head, `Closes #${step('14.2')}`);
  merge(pr);
  git(learner, ['push', '-q', 'origin', 'late-plan']);
  const { code, output } = await station_('push', { ref: 'refs/heads/late-plan', after: head });
  assert.equal(code, 0, output);
  assert.match(output, new RegExp(`Catching up on merged pull request #${pr.number}`));
  assert.equal(progress().step, 2);
  restore();
});

test('merging Mika\'s pull request before the correction opens a repair task', async () => {
  const saved = api.state.snapshots[api.state.branches.main][PROGRESS_PATH];
  const steps = { ...progress().steps };
  delete steps['16.R'];
  api.state.snapshots[api.state.branches.main] = {
    ...api.state.snapshots[api.state.branches.main],
    [PROGRESS_PATH]: JSON.stringify({ ...progress(), step: 3, complete: false, chunk: '16.1', steps, review: { opened: 'x' } }),
    [REPORT_PATH]: 'Maintenance released Bay 3 at 22:40.\nAster docked at 22:40.\n',
  };
  const pr = { ...reviewPr, merged: true, merge_commit_sha: api.state.branches.main };
  const { code, output } = await station_('pull_request', pullRequestEvent('closed', pr));
  assert.equal(code, 0, output);
  assert.equal(progress().step, 4);
  const repair = stepIssueOf('16.R');
  assert.equal(repair.title, 'M16.2 · Repair the release time');
  assert.match(repair.body, new RegExp(`Closes #${repair.number}`));
  api.state.snapshots[api.state.branches.main][PROGRESS_PATH] = saved;
});

test('a refused pull request leaves a task explaining the repository setting', async () => {
  api.state.refusePulls = true;
  api.state.snapshots[api.state.branches.main][PROGRESS_PATH] = JSON.stringify({ ...progress(), step: 3, complete: false, prs: { ...progress().prs, review: undefined }, review: {} });
  api.state.pulls = api.state.pulls.filter((p) => p.head.ref !== REVIEW_BRANCH);
  const { code, output, summary } = await station_('workflow_dispatch', {});
  assert.equal(code, 0, output);
  const task = api.state.issues.find((i) => i.title === 'Station control needs permission to open a pull request');
  assert.match(task.body, /Allow GitHub Actions to create and approve pull requests/);
  assert.match(summary, new RegExp(`issues/${task.number}`));
  api.state.refusePulls = false;
});

test('the template repository itself stays offline', async () => {
  // Uses the name in config.mjs, so renaming the template doesn't break this.
  // Run asynchronously: a blocking run would stop the fake API answering.
  const before = api.calls.length;
  const eventPath = join(root, 'template-event.json');
  writeFileSync(eventPath, '{}');
  const output = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/station.mjs')], {
      env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: TEMPLATE_REPOSITORY, GITHUB_API_URL: api.url },
    });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', () => resolve(text));
  });
  assert.match(output, /stays offline/);
  assert.equal(api.calls.length, before, 'no GitHub calls from the template');
});
