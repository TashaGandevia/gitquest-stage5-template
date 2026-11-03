#!/usr/bin/env node
// Station control: moves the December 8 shift on. It reads the GitHub event,
// the trusted progress file on the default branch, and the learner's commits,
// then opens tasks, publishes notices, plays Mika's side of the review and
// records progress. Every transition is safe to repeat: a resumed or repeated
// run finds what already exists instead of creating it twice.

import { randomInt } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import {
  ARRIVALS_PATH,
  CODE_ALPHABET,
  CODE_LENGTH,
  COMPLETION_JSON_PATH,
  COMPLETION_PATH,
  GITQUEST_REDEEM_URL,
  README_PATH,
  DOCKING_NOTICES_PATH,
  HANDOVER_PATH,
  LABELS,
  MAINTENANCE_NOTICES_PATH,
  PLAN_PATH,
  PROGRESS_PATH,
  RECORD_CHECKS_WORKFLOW,
  REPORT_PATH,
  REVIEW_BRANCH,
  T,
  TEMPLATE_REPOSITORY,
  TRANSMISSION_PREFIX,
} from './lib/config.mjs';
import { ASTER, ASTER_ARRIVAL, DOCKING_NOTICES, HOLD_NOTICE, RELEASE_NOTICE, bayReport } from './lib/content.mjs';
import { collectPullRequest, git, showFile } from './lib/evidence.mjs';
import { createClient } from './lib/github.mjs';
import { publishInspection } from './lib/inspection.mjs';
import * as messages from './lib/messages.mjs';
import { BADGES } from './lib/badges.mjs';
import { confirmation, directPushUndone, mergedTooEarly, revertAdvice, revertMerged, shiftReport, stepIssue, stepTitle } from './lib/missions.mjs';
import { renderReadme } from './lib/readme.mjs';
import { appendBlock, appendLine, parseReport } from './lib/records.mjs';
import {
  STEP,
  LINK_STEP,
  allSteps,
  completionCode,
  linkIssue,
  allFindings,
  blocking,
  evaluatePullRequest,
  initialProgress,
  inspectDiscrepancy,
  isAhead,
  stepOrder,
  linksIssue,
  namesReleaseTime,
  passed,
  renderFindings,
  revertOf,
} from './lib/story.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const eventName = process.env.GITHUB_EVENT_NAME;
const repository = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const runUrl = `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
const gh = createClient({ token: process.env.GITHUB_TOKEN, repository, apiUrl: process.env.GITHUB_API_URL });

const issueUrl = (n) => `${serverUrl}/${repository}/issues/${n}`;
const pullUrl = (n) => `${serverUrl}/${repository}/pull/${n}`;
const progressFile = (progress) => `${JSON.stringify(progress, null, 2)}\n`;
const transmission = (number, summary) => `${TRANSMISSION_PREFIX}${number}: ${summary}`;

let branch; // the default branch
let progress;
let summaryNote = '';

async function readProgress() {
  const text = await gh.readFile(PROGRESS_PATH, branch);
  return text ? JSON.parse(text) : initialProgress();
}

// Commits the new progress (and any other files) to the default branch.
// Commits the new progress (and any other files) to the default branch, and
// rewrites the README's badges and "Your shift" sections to match.
async function save(next, number, summary, files = async () => ({})) {
  await gh.commit(branch, transmission(number, summary), async (read) => ({
    ...(await files(read)),
    [PROGRESS_PATH]: progressFile(next),
    [README_PATH]: renderReadme(await read(README_PATH), next),
  }));
  progress = next;
  return next;
}

const update = (changes) => ({
  ...progress,
  ...changes,
  issues: { ...progress.issues, ...changes.issues },
  prs: { ...progress.prs, ...changes.prs },
  review: { ...progress.review, ...changes.review },
  steps: { ...progress.steps, ...changes.steps },
});

async function main() {
  if (repository === TEMPLATE_REPOSITORY) return console.log('Template repository: station control stays offline.');
  const repo = await gh.repository();
  if (repo.is_template) return console.log('Template repository: station control stays offline.');
  if (event.sender?.type === 'Bot') return console.log('Ignoring an event from a bot.');

  branch = repo.default_branch;
  progress = await readProgress();
  console.log(`Shift step ${progress.step}, event ${eventName}${event.action ? `.${event.action}` : ''}.`);

  if (eventName === 'workflow_dispatch') {
    await (progress.step === STEP.NOT_STARTED ? start() : resume());
  } else if (progress.step === STEP.NOT_STARTED) {
    summaryNote = 'The shift has not started. Open **Actions → Station control → Run workflow**.';
  } else if (eventName === 'pull_request' && event.action === 'closed') {
    await pullRequestClosed(event.pull_request);
  } else if (eventName === 'pull_request') {
    await proposalUpdated(event.pull_request);
  } else if (eventName === 'push') {
    await branchPushed();
  } else if (eventName === 'pull_request_review') {
    await reviewSubmitted(event.pull_request, event.review);
  } else if (eventName === 'issues') {
    await issueEvent(event.issue);
  } else if (eventName === 'issue_comment') {
    await commentCreated(event.issue, event.comment);
  } else {
    console.log('Nothing for station control to do.');
  }
  if (eventName !== 'workflow_dispatch') await catchUp();
  writeRunSummary();
}

// Opens a task issue (or finds the one already open), then writes its own
// number into the body so learners can copy `Closes #N` exactly.
// Screenshots load from .github/screenshots in this repository (the player's
// own copy, which is public), so images added to the template travel with it.
const screenshotsUrl = () => `https://raw.githubusercontent.com/${repository}/${branch}/.github/screenshots`;

async function openTask(task) {
  const number = await gh.ensureIssue(task);
  if (task.body.includes(messages.ISSUE_NUMBER) || task.body.includes(messages.SCREENSHOTS)) {
    const body = task.body.replaceAll(messages.ISSUE_NUMBER, String(number)).replaceAll(messages.SCREENSHOTS, screenshotsUrl());
    await gh.updateIssue(number, { body });
  }
  return number;
}

// ---------------------------------------------------------------- steps
// Each step is its own small issue, opened when the step before it is done.
// The player ticks every box and closes each issue themselves (except the one
// a pull request closes). When a step is done, the character who'd notice
// confirms it on that step's issue and links the next one.

// What the step texts need to know. `link` is the issue this part's pull request closes.
const stepContext = () => ({
  link: linkIssue(progress),
  handoverPr: progress.prs.handover,
  discrepancy: progress.issues.discrepancy,
  reviewPr: progress.prs.review,
});

// Opens the step's issue (or finds it), filling in its own number.
async function openStep(key) {
  if (progress.steps?.[key]) return progress.steps[key];
  const number = await openTask(stepIssue(key, stepContext()));
  progress = update({ steps: { [key]: number } });
  return number;
}

// The steps finished by moving from the current step to `target` (or to the end).
function doneSteps(target) {
  const order = allSteps(progress);
  const from = progress.chunk ? order.indexOf(progress.chunk) : -1;
  if (from < 0) return [];
  return order.slice(from, target ? order.indexOf(target) : order.length).filter((key) => progress.steps?.[key]);
}

// Posts a confirmation on each finished step's issue; the last one links `next`.
async function confirmSteps(keys, next, pr) {
  const c = { ...stepContext(), pr: pr ?? progress.prs.handover, repair: progress.review?.repair };
  for (const [i, key] of keys.entries()) {
    const self = progress.steps[key];
    if (key === '14.1') c.assigned = ((await gh.getIssue(self)).assignees ?? []).length > 0;
    const body = confirmation(key, { c, next: i === keys.length - 1 ? next : null, login: event.sender?.login, self });
    await gh.commentOnce(self, `gitquest:confirm-${key}`, body);
  }
}

// Makes `target` the current step: opens its issue and confirms the steps
// before it. Steps only move forward.
async function moveTo(target, { pr } = {}) {
  if (!isAhead(progress, target)) return false;
  const done = doneSteps(target);
  const number = await openStep(target);
  // The link step's own number is only known now, so build the title with it.
  const title = stepTitle(target, stepContext());
  await save(update({ chunk: target }), T.step, `step ${target} opened as #${number}`);
  await confirmSteps(done, { number, title }, pr);
  if (pr) await gh.commentOnce(pr, `gitquest:next-${target}`, messages.nextStep(number, title));
  return true;
}

// Confirms every remaining step at the end of the stage.
async function finishSteps(pr) {
  await confirmSteps(doneSteps(null), null, pr);
}

// ---------------------------------------------------------------- start and resume

async function start() {
  for (const label of LABELS) await gh.ensureLabel(label);
  await save(update({ step: STEP.PLAN }), T.opened, 'shift pack opened');
  await moveTo('14.1');
  const first = progress.steps['14.1'];
  summaryNote = messages.shiftOpened(issueUrl(first));
  console.log(`Shift opened: M14.1 is #${first}.`);
}

// Reconciles anything a missed or failed event left undone, then points the
// learner at their current task. Safe to run at any time.
async function resume() {
  for (const label of LABELS) await gh.ensureLabel(label);
  summaryNote = 'Station control checked the shift and picked up where it left off.';

  if (progress.step === STEP.HANDOVER && !progress.issues.discrepancy) await recoverDiscrepancy();

  if (LINK_STEP[progress.step]) {
    const merged = await findCompletingMerge();
    if (merged) return pullRequestClosed(merged);
    // The issue a pull request will close must stay open until that merge.
    const n = linkIssue(progress);
    if (n && (await gh.getIssue(n)).state === 'closed' && allSteps(progress).indexOf(progress.chunk) >= allSteps(progress).indexOf(LINK_STEP[progress.step])) {
      await gh.setIssueState(n, 'open');
      await gh.comment(n, messages.reopenedTask(n));
    }
  }

  // Make sure the step this part of the story starts with exists.
  const FIRST_STEP = { [STEP.PLAN]: '14.1', [STEP.HANDOVER]: '15.1', [STEP.REPAIR]: '16.R', [STEP.FINAL]: '16.3' };
  if (FIRST_STEP[progress.step]) await moveTo(FIRST_STEP[progress.step]);

  if (progress.step === STEP.REVIEW) {
    if (!progress.prs.review || !progress.steps?.['16.1']) return openReviewPullRequest();
    const pr = await gh.getPullRequest(progress.prs.review);
    if (pr.merged) return reviewPullRequestMerged(pr);
    if (pr.state === 'closed') await gh.setPullRequestState(pr.number, 'open');
    if (!progress.review.corrected) {
      for (const review of (await gh.listReviews(pr.number)).reverse()) {
        if (review.state === 'CHANGES_REQUESTED' && namesReleaseTime(await reviewText(pr.number, review))) {
          return applyCorrection(pr.number);
        }
      }
    }
    await inspectReviewPullRequest(pr.number);
  }
}

// A merged learner pull request that completes the current task, if a missed
// event left one unprocessed.
async function findCompletingMerge() {
  for (const pr of (await gh.listClosedPullRequests()).slice(0, 10)) {
    if (!pr.merged_at || pr.user?.type === 'Bot') continue;
    if ((progress.handled ?? []).includes(pr.number)) continue; // its merge already moved the story on
    try {
      const evaluation = evaluatePullRequest(progress, collectPullRequest(pr, branch));
      if (evaluation && blocking(allFindings(evaluation)).length === 0) return { ...pr, merged: true };
    } catch (error) {
      console.log(`Couldn't read pull request #${pr.number}: ${error.message}`);
    }
  }
  return null;
}

// A run that was waiting can be replaced by a newer one and never happen.
// Every run therefore checks whether a merge that completes the current
// mission went unprocessed, and finishes it.
async function catchUp() {
  if (!LINK_STEP[progress.step] || progress.complete) return;
  const merged = await findCompletingMerge();
  if (merged) {
    console.log(`Catching up on merged pull request #${merged.number}.`);
    await pullRequestClosed(merged);
  }
}

// A valid discrepancy issue whose event station control never processed.
async function recoverDiscrepancy() {
  for (const issue of await gh.listIssues('record-discrepancy', 'all')) {
    if (passed(inspectDiscrepancy(issue.body).findings)) return issueEvent(issue);
  }
}

// ---------------------------------------------------------------- pushes and open pull requests
// These only move the mission's steps on. Record checks does the inspecting.

async function branchPushed() {
  const pushed = event.ref?.replace('refs/heads/', '');
  if (pushed === branch) return mainPushed();
  if (progress.step !== STEP.PLAN || event.deleted || !pushed) return;
  git('fetch', '--no-tags', '--quiet', 'origin', `+refs/heads/${pushed}:refs/remotes/origin/${pushed}`, `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
  const base = git('merge-base', `origin/${branch}`, event.after);
  const changed = git('diff', '--name-only', base, event.after).split('\n');
  if (changed.includes(PLAN_PATH)) await moveTo('14.2');
}

// A push straight to main that changes a record, not a pull request merge.
// Station control undoes it with a new commit (history is kept) and Voss
// explains, with a "do this instead" checklist on the mission issue.
async function mainPushed() {
  if (progress.step === STEP.NOT_STARTED || progress.complete || event.deleted) return;
  const after = event.after;
  const viaPullRequest = (await gh.pullsForCommit(after)).some((pr) => pr.merged_at)
    || (await gh.listClosedPullRequests()).some((pr) => pr.merge_commit_sha === after);
  if (viaPullRequest) return console.log('Main moved by a merged pull request.');

  git('fetch', '--no-tags', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
  const changed = git('diff', '--name-only', event.before, after).split('\n')
    .filter((path) => path.startsWith('docking-log/') && !path.startsWith('docking-log/notices/'));
  if (!changed.length) return console.log('Direct push to main left the records alone.');

  await gh.commit(branch, transmission(T.restore, `undo a direct push to main (${changed.join(', ')})`), async () =>
    Object.fromEntries(changed.map((path) => [path, showFile(event.before, path)])));
  const current = progress.steps?.[progress.chunk];
  const closes = linkIssue(progress);
  await gh.comment(current, directPushUndone({ step: progress.step, closes, files: changed, login: event.sender?.login }));
  summaryNote = `A direct push to main was undone. Voss explains in [#${current}](${issueUrl(current)}).`;
}

async function proposalUpdated(pr) {
  if (pr.user?.type === 'Bot' || pr.number === progress.prs.review) return;
  const reverted = revertOf(pr);
  if (reverted) {
    return gh.commentOnce(pr.number, 'gitquest:revert', revertAdvice({ step: progress.step, closes: linkIssue(progress), reverted, login: event.sender?.login }));
  }
  // Say "don't merge yet" before any result is in.
  if (event.action === 'opened' && LINK_STEP[progress.step]) await gh.commentOnce(pr.number, 'gitquest:wait', messages.waitForChecks);
  const evidence = collectPullRequest(pr, branch);
  const touches = (path) => evidence.changedPaths.includes(path);
  if (progress.step === STEP.PLAN && touches(PLAN_PATH)) return moveTo('14.3', { pr: pr.number });
  if (progress.step === STEP.HANDOVER && touches(HANDOVER_PATH)) {
    progress = update({ prs: { handover: pr.number } });
    const handover = evaluatePullRequest(progress, evidence)?.parts.find((p) => p.id === 'handover');
    const formatOk = handover && passed(handover.findings);
    const target = !formatOk ? '15.2' : progress.issues.discrepancy ? '15.4' : '15.3';
    return moveTo(target, { pr: pr.number });
  }
  if (progress.step === STEP.FINAL && touches(HANDOVER_PATH)) return moveTo('16.4', { pr: pr.number });
}

// ---------------------------------------------------------------- merges

async function pullRequestClosed(pr) {
  if (!pr.merged) {
    if (pr.number === progress.prs.review) await gh.comment(pr.number, messages.reviewClosedUnmerged);
    return console.log('Closed without merging.');
  }
  if (pr.number === progress.prs.review) return reviewPullRequestMerged(pr);
  const reverted = revertOf(pr);
  if (reverted) {
    progress = update({ handled: [...(progress.handled ?? []), pr.number] });
    await save(progress, T.step, `revert of #${reverted} merged`);
    return gh.commentOnce(pr.number, 'gitquest:revert-merged', revertMerged({ reverted, login: event.sender?.login }));
  }

  const evaluation = evaluatePullRequest(progress, collectPullRequest(pr, branch));
  if (!evaluation) return console.log('No task was waiting on this pull request.');
  const findings = allFindings(evaluation);
  const task = evaluation.task;

  if (blocking(findings).length > 0) {
    await gh.setIssueState(task, 'open'); // a "Closes #" may have closed it on merge
    const problems = renderFindings(findings.filter((f) => !f.ok && f.kind === 'content'));
    return gh.comment(pr.number, mergedTooEarly({ step: progress.step, closes: task, problems, login: event.sender?.login }));
  }

  if (progress.step === STEP.HANDOVER && !progress.issues.discrepancy) {
    await gh.setIssueState(task, 'open');
    return gh.commentOnce(pr.number, 'gitquest:handover-waiting', messages.handoverMergedWaiting);
  }

  // Close what the description forgot to close, and say so.
  const toClose = [progress.step === STEP.REPAIR ? null : task, progress.step === STEP.HANDOVER ? progress.issues.discrepancy : null]
    .filter(Boolean)
    .filter((n) => !linksIssue(pr.body, n));
  for (const n of toClose) await gh.setIssueState(n, 'closed');
  if (toClose.length) await gh.comment(pr.number, messages.closedForYou(toClose));

  // Remember this merge, so catching up never handles it twice.
  progress = update({ handled: [...(progress.handled ?? []), pr.number] });
  if (progress.step === STEP.PLAN) return advanceToHandover(pr);
  if (progress.step === STEP.HANDOVER) return advanceToReview(pr.number);
  if (progress.step === STEP.REPAIR) return advanceToFinal(pr.number, { approved: true, repairPr: pr.number });
  if (progress.step === STEP.FINAL) return completeStage(pr);
}

async function advanceToHandover(pr) {
  await save(update({ step: STEP.HANDOVER, prs: { plan: pr.number } }), T.holdNotice, 'Maintenance hold on Bay 3', async (read) => {
    const notices = await read(MAINTENANCE_NOTICES_PATH);
    return notices?.includes('## 18:15') ? {} : { [MAINTENANCE_NOTICES_PATH]: appendBlock(notices, HOLD_NOTICE) };
  });
  await gh.commentOnce(pr.number, 'gitquest:plan-merged', messages.planMerged);
  await moveTo('15.1', { pr: pr.number });
}

async function advanceToReview(handoverPr) {
  await save(update({ step: STEP.REVIEW, prs: { handover: handoverPr }, review: { branch: REVIEW_BRANCH } }), T.released, 'Bay 3 released, Aster docked', async (read) => {
    const notices = await read(MAINTENANCE_NOTICES_PATH);
    return {
      ...(notices?.includes('## 22:25') ? {} : { [MAINTENANCE_NOTICES_PATH]: appendBlock(notices, RELEASE_NOTICE) }),
      ...((await read(DOCKING_NOTICES_PATH)) ? {} : { [DOCKING_NOTICES_PATH]: DOCKING_NOTICES }),
    };
  });
  await gh.commentOnce(handoverPr, 'gitquest:handover-merged', messages.handoverMerged);
  await openReviewPullRequest(handoverPr);
}

// ---------------------------------------------------------------- the review pull request

// Creates (or finds) Mika's branch and pull request. Returns its number, or
// null when GitHub refused, in which case a task explains the setting to change.
async function openReviewPullRequest(announceOn) {
  let pr = await gh.findPullRequest(REVIEW_BRANCH);
  if (!pr) {
    if (!(await gh.branchSha(REVIEW_BRANCH))) await gh.createBranch(REVIEW_BRANCH, await gh.branchSha(branch));
    // Draft the proposal only once: a resumed run must not overwrite a correction.
    if ((await gh.readFile(REPORT_PATH, await gh.branchSha(REVIEW_BRANCH))) == null) {
      await gh.commit(REVIEW_BRANCH, transmission(T.arrivalProposal, 'Record Aster arrival and bay report'), async (read) => {
        const arrivals = await read(ARRIVALS_PATH);
        return {
          ...(arrivals.includes(ASTER_ARRIVAL) ? {} : { [ARRIVALS_PATH]: appendLine(arrivals, ASTER_ARRIVAL) }),
          [REPORT_PATH]: bayReport({ discrepancy: progress.issues.discrepancy, handoverPr: progress.prs.handover, releaseTime: ASTER.time }),
        };
      });
    }
    try {
      pr = await gh.createPullRequest({
        ...messages.reviewPullRequest({ discrepancy: progress.issues.discrepancy, handoverPr: progress.prs.handover }),
        head: REVIEW_BRANCH,
        base: branch,
        labels: ['station'],
      });
    } catch (error) {
      if (error.status !== 403 && error.status !== 422) throw error;
      console.log(`GitHub refused the pull request: ${error.message}`);
      const task = await openTask(messages.reviewPermissionTask);
      summaryNote = `Station control needs a repository setting changed. See [#${task}](${issueUrl(task)}).`;
      return null;
    }
  }
  await save(update({ prs: { review: pr.number }, review: { opened: pr.head.sha } }), T.reviewOpened, `review pull request #${pr.number} opened`);
  await inspectReviewPullRequest(pr.number);
  await moveTo('16.1', { pr: announceOn });
  return pr.number;
}

// Pull requests created or updated with GITHUB_TOKEN don't start other
// workflows, so station control dispatches Record checks deliberately. If the
// dispatch itself is refused, it inspects in this run instead.
async function inspectReviewPullRequest(number) {
  try {
    await gh.dispatchWorkflow(RECORD_CHECKS_WORKFLOW, branch, { pull_request: String(number) });
    console.log(`Dispatched Record checks for #${number}.`);
  } catch (error) {
    console.log(`Dispatch refused (${error.status}); inspecting here instead.`);
    const pr = await gh.getPullRequest(number);
    const evidence = collectPullRequest(pr, branch);
    const evaluation = evaluatePullRequest(progress, evidence);
    if (evaluation) await publishInspection({ gh, progress, evaluation, pr: evidence, runUrl, statusForChecks: true });
  }
}

async function reviewText(number, review) {
  const inline = await gh.listReviewComments(number, review.id);
  return [review.body ?? '', ...inline.map((c) => c.body)].join('\n');
}

async function reviewSubmitted(pr, review) {
  if (pr.number !== progress.prs.review || progress.step !== STEP.REVIEW) return console.log('Not the review task.');
  const state = review.state.toLowerCase();
  const corrected = progress.review.corrected;
  const marker = `gitquest:review-${review.id}`;

  if (!corrected) {
    const text = await reviewText(pr.number, review);
    if (state === 'changes_requested') {
      return namesReleaseTime(text) ? applyCorrection(pr.number) : gh.commentOnce(pr.number, marker, messages.reviewNeedsTime);
    }
    if (state === 'approved') return gh.commentOnce(pr.number, marker, messages.reviewApprovedFaulty);
    if (namesReleaseTime(text)) return gh.commentOnce(pr.number, marker, messages.reviewCommentNudge);
    return;
  }
  if (state === 'approved') {
    return review.commit_id === corrected
      ? gh.commentOnce(pr.number, 'gitquest:review-approved', messages.reviewApproved)
      : gh.commentOnce(pr.number, marker, messages.reviewApprovedStale);
  }
  if (state === 'changes_requested') return gh.commentOnce(pr.number, marker, messages.reviewChangesAfterCorrection);
}

async function applyCorrection(number) {
  const head = await gh.branchSha(REVIEW_BRANCH);
  const report = await gh.readFile(REPORT_PATH, head);
  const sha = parseReport(report).release === ASTER.release
    ? head
    : await gh.commit(REVIEW_BRANCH, transmission(T.correction, 'Correct Bay 3 release time'), async () => ({
      [REPORT_PATH]: bayReport({ discrepancy: progress.issues.discrepancy, handoverPr: progress.prs.handover, releaseTime: ASTER.release }),
    }));
  await gh.commentOnce(number, 'gitquest:review-corrected', messages.reviewCorrected);
  await save(update({ review: { corrected: sha } }), T.corrected, 'review answered, release time corrected');
  await inspectReviewPullRequest(number);
  await moveTo('16.2', { pr: number });
}

async function commentCreated(issue, comment) {
  if (!issue.pull_request || issue.number !== progress.prs.review) return;
  if (progress.step !== STEP.REVIEW || progress.review.corrected) return;
  if (comment.user?.type === 'Bot' || !namesReleaseTime(comment.body)) return;
  await gh.commentOnce(issue.number, 'gitquest:comment-nudge', messages.reviewCommentNudge);
}

async function reviewPullRequestMerged(pr) {
  if (progress.step !== STEP.REVIEW) return console.log('The review pull request was already handled.');
  const report = await gh.readFile(REPORT_PATH, pr.merge_commit_sha ?? branch);
  if (parseReport(report).release === ASTER.release) {
    const reviews = await gh.listReviews(pr.number);
    const approved = reviews.some((r) => r.state === 'APPROVED' && r.commit_id === pr.head.sha);
    return advanceToFinal(pr.number, { approved });
  }
  await gh.commentOnce(pr.number, 'gitquest:review-merged-early', messages.reviewMergedEarly);
  await save(update({ step: STEP.REPAIR, review: { repair: true } }), T.repairTask, 'repair step');
  await moveTo('16.R', { pr: pr.number });
}

async function advanceToFinal(mergedPr, { approved, repairPr }) {
  await gh.commentOnce(mergedPr, 'gitquest:review-merged', messages.reviewMerged({ approved }));
  await save(update({ step: STEP.FINAL, prs: repairPr ? { repair: repairPr } : {} }), T.finalTask, 'final handover step');
  await moveTo('16.3', { pr: mergedPr });
}

// ---------------------------------------------------------------- the end

async function completeStage(pr) {
  // The code is made once and kept: a repeated run reuses it.
  const code = progress.completion?.code ?? completionCode(randomInt, CODE_ALPHABET, CODE_LENGTH);
  const redeemUrl = `${GITQUEST_REDEEM_URL}?repo=${encodeURIComponent(repository)}&code=${code}`;
  const report = await openTask(shiftReport({ code, redeemUrl }));
  const next = update({ step: STEP.COMPLETE, complete: true, prs: { final: pr.number }, completion: { code, issue: report } });
  await save(next, T.complete, 'stage complete', async () => ({
    [COMPLETION_PATH]: completionSummary(next, pr),
    [COMPLETION_JSON_PATH]: completionJson(next, pr),
  }));
  await finishSteps(pr.number);
  await gh.commentOnce(progress.steps['16.4'], 'gitquest:stage-complete', messages.stageComplete(report));
  summaryNote = `The December 8 shift pack is complete. Your GitQuest code is in [#${report}](${issueUrl(report)}).`;
}

// What GitQuest reads to redeem the code. See "GitQuest completion code" in MAINTAINING.md.
function completionJson(state, finalPr) {
  return `${JSON.stringify({
    schema: 1,
    stage: 5,
    code: state.completion.code,
    repository,
    completedAt: new Date().toISOString(),
    badges: BADGES.map((b) => b.id),
    finalMergeCommit: finalPr.merge_commit_sha ?? null,
    steps: state.steps,
    pullRequests: state.prs,
  }, null, 2)}\n`;
}

// Learner-editable progress evidence, not certification: see MAINTAINING.md.
function completionSummary(state, finalPr) {
  const step = (key, label) => (state.steps?.[key] ? `| ${label} | [#${state.steps[key]}](${issueUrl(state.steps[key])}) |` : null);
  const issue = (key, label) => (state.issues[key] ? `| ${label} | [#${state.issues[key]}](${issueUrl(state.issues[key])}) |` : null);
  const pull = (key, label) => (state.prs[key] ? `| ${label} | [#${state.prs[key]}](${pullUrl(state.prs[key])}) |` : null);
  return [
    '# December 8 shift pack: completion summary',
    '',
    'Written by station control when the final handover merged. It is a record of progress in this repository, not a certificate: anyone with write access can edit it.',
    '',
    '| Record | Link |',
    '|---|---|',
    ...allSteps(state).map((key) => step(key, `M${key} task`)),
    pull('plan', 'M14 plan pull request'),
    issue('discrepancy', 'M15 record discrepancy'),
    pull('handover', 'M15 handover pull request'),
    pull('review', 'M16 reviewed pull request'),
    pull('repair', 'M16 repair pull request'),
    pull('final', 'M16 final handover pull request'),
    '',
    `Final merge commit: \`${finalPr.merge_commit_sha ?? 'unknown'}\``,
    `Corrected report commit: \`${state.review.corrected ?? 'none (repaired by learner)'}\``,
    '',
  ].filter((line) => line !== null).join('\n');
}

// ---------------------------------------------------------------- discrepancy issues

async function issueEvent(issue) {
  if (issue.pull_request) return;
  if (issue.user?.type === 'Bot') return;
  const isDiscrepancy = issue.labels.some((label) => (label.name ?? label) === 'record-discrepancy');
  if (progress.step !== STEP.HANDOVER) return console.log('No issue is expected at this step.');

  if (!isDiscrepancy) {
    if (event.action === 'opened' && /discrepan|bay 3|instruction/i.test(`${issue.title}\n${issue.body}`)) {
      await gh.commentOnce(issue.number, 'gitquest:discrepancy-template', messages.discrepancyNeedsTemplate);
    }
    return;
  }
  if (progress.issues.discrepancy && progress.issues.discrepancy !== issue.number) {
    return gh.commentOnce(issue.number, 'gitquest:discrepancy-duplicate', messages.discrepancyAlreadyRecorded(progress.issues.discrepancy));
  }

  const { findings, pullRequest } = inspectDiscrepancy(issue.body);
  if (!passed(findings)) return gh.upsertComment(issue.number, 'gitquest:discrepancy-check', messages.discrepancyNeedsWork(findings));

  if (!progress.issues.discrepancy) {
    await save(update({ issues: { discrepancy: issue.number } }), T.discrepancy, `discrepancy #${issue.number} recorded`);
  }

  // Link it to the handover pull request and refresh that pull request's readiness.
  const open = (await gh.listOpenPullRequests()).filter((pr) => pr.user?.type !== 'Bot');
  const target = open.find((pr) => pr.number === pullRequest) ?? open[0];
  await gh.upsertComment(issue.number, 'gitquest:discrepancy-check',
    messages.discrepancyAcknowledged({ issue: issue.number, pr: target?.number ?? pullRequest }));
  for (const pr of open) {
    const evidence = collectPullRequest(pr, branch);
    const evaluation = evaluatePullRequest(progress, evidence);
    if (!evaluation) continue;
    await publishInspection({ gh, progress, evaluation, pr: evidence, runUrl });
    if (pr.number === target.number) await gh.commentOnce(pr.number, 'gitquest:voss-discrepancy', messages.vossDiscrepancy);
  }
  if (target) {
    progress = update({ prs: { handover: target.number } });
    await moveTo('15.4', { pr: target.number });
  }

  // The handover may already have merged while it waited for this issue.
  const merged = await findCompletingMerge();
  if (merged) await pullRequestClosed(merged);
}

// ---------------------------------------------------------------- run summary

// One obvious link to the current step, so an interrupted learner can find it.
function writeRunSummary() {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  let current;
  if (progress.complete) {
    current = { title: 'Stage complete.' };
  } else if (progress.chunk && progress.steps?.[progress.chunk]) {
    const n = progress.steps[progress.chunk];
    current = { title: `${stepTitle(progress.chunk, stepContext())} (#${n})`, url: issueUrl(n) };
  } else {
    current = { title: 'No step is open yet.' };
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, messages.runSummary({ ...current, note: summaryNote }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
