#!/usr/bin/env node
// Station control: the mission engine both workflows run. It reads the event
// GitHub Actions hands it, the trusted progress file on the default branch, and
// the learner's commits, then inspects, comments, and moves the mission on.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  ARRIVALS_PATH,
  DEPARTURES_PATH,
  FAULTS_PATH,
  LABELS,
  PROGRESS_PATH,
  TEMPLATE_REPOSITORY,
  TRANSMISSION_PREFIX,
} from './lib/config.mjs';
import { createClient } from './lib/github.mjs';
import { appendLine } from './lib/log.mjs';
import * as messages from './lib/messages.mjs';
import { SHIPS, initialProgress, inspectFaultFix, inspectPullRequest, line, passed, report } from './lib/mission.mjs';

const INSPECTION_MARKER = 'gitquest:inspection';
const FAULT_MARKER = 'gitquest:fault-check';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const eventName = process.env.GITHUB_EVENT_NAME;
const repository = process.env.GITHUB_REPOSITORY;
const gh = createClient({ token: process.env.GITHUB_TOKEN, repository, apiUrl: process.env.GITHUB_API_URL });

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function isAncestor(commit, of) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, of]);
    return true;
  } catch {
    return false;
  }
}

function showFile(commit, path) {
  try {
    return git('show', `${commit}:${path}`);
  } catch {
    return null;
  }
}

const progressFile = (progress) => `${JSON.stringify(progress, null, 2)}\n`;

function transmission(number, summary) {
  return `${TRANSMISSION_PREFIX}${number}: ${summary}`;
}

async function readProgress(branch) {
  const text = await gh.readFile(PROGRESS_PATH, branch);
  return text ? JSON.parse(text) : initialProgress();
}

async function main() {
  if (repository === TEMPLATE_REPOSITORY) return console.log('Template repository: station control stays offline.');
  const repo = await gh.repository();
  if (repo.is_template) return console.log('Template repository: station control stays offline.');
  if (event.sender?.type === 'Bot') return console.log('Ignoring an event from a bot.');

  const branch = repo.default_branch;
  const progress = await readProgress(branch);
  console.log(`Mission step ${progress.step}, event ${eventName}${event.action ? `.${event.action}` : ''}.`);

  if (eventName === 'workflow_dispatch' || (eventName === 'push' && progress.step === 0)) {
    return progress.step === 0 ? setup(branch, progress) : console.log('Mission already started.');
  }
  if (eventName === 'push' && event.ref === `refs/heads/${branch}` && progress.step === 4) {
    return faultFixPushed(branch, progress);
  }
  if (eventName === 'pull_request') {
    return event.action === 'closed' ? pullRequestClosed(branch, progress) : inspect(branch, progress);
  }
  if (eventName === 'issues' && progress.step === 3) return issueOpened(branch, progress);
  console.log('Nothing for station control to do.');
}

async function setup(branch, progress) {
  for (const label of LABELS) await gh.ensureLabel(label);
  const task1 = await gh.createIssue(messages.task1);
  await gh.commit(branch, transmission(0, 'mission started'), async () => ({
    [PROGRESS_PATH]: progressFile({ ...progress, step: 1, issues: { task1 } }),
  }));
  console.log(`Mission started: task #${task1}.`);
}

// What inspectPullRequest needs, read from the pull request's commits.
function collectPullRequest(pr, branch, step) {
  git('fetch', '--no-tags', 'origin', `+refs/pull/${pr.number}/head:refs/remotes/pull/${pr.number}`);
  const head = pr.head.sha;
  const forkPoint = git('merge-base', pr.base.sha, head);
  const latest = git('log', `origin/${branch}`, '-1', '--format=%H', '--fixed-strings', `--grep=${transmission(step - 1, '')}`);
  const range = `${forkPoint}..${head}`;
  return {
    body: pr.body ?? '',
    files: {
      [DEPARTURES_PATH]: showFile(head, DEPARTURES_PATH),
      [ARRIVALS_PATH]: showFile(head, ARRIVALS_PATH),
    },
    changedPaths: git('diff', '--name-only', forkPoint, head).split('\n').filter(Boolean),
    committerEmails: git('log', '--format=%ce', range).split('\n').filter(Boolean),
    containsTransmission: latest !== '' && isAncestor(latest, head),
  };
}

async function inspect(branch, progress) {
  const pr = event.pull_request;
  const findings = inspectPullRequest(progress, collectPullRequest(pr, branch, progress.step));
  if (!findings) return gh.upsertComment(pr.number, INSPECTION_MARKER, messages.noTaskNeedsPullRequest);
  await gh.upsertComment(pr.number, INSPECTION_MARKER, report('Docking inspection', findings));
  if (!passed(findings)) {
    console.log(report('Docking inspection', findings));
    process.exitCode = 1;
  }
}

async function pullRequestClosed(branch, progress) {
  const pr = event.pull_request;
  if (!pr.merged) return console.log('Closed without merging.');
  const findings = inspectPullRequest(progress, collectPullRequest(pr, branch, progress.step));
  if (!findings) return console.log('No task was waiting on a pull request.');

  const issue = progress.issues[`task${progress.step}`];
  if (!passed(findings)) {
    await gh.setIssueState(issue, 'open'); // a "Closes #" may have closed it on merge
    return gh.comment(pr.number, messages.mergedWithoutPassing(issue));
  }

  if (progress.step === 1) {
    const task2 = await gh.createIssue(messages.task2);
    await gh.commit(branch, transmission(1, 'Osprey inbound'), async (read) => ({
      [ARRIVALS_PATH]: appendLine(await read(ARRIVALS_PATH), line(SHIPS.ospreyInbound)),
      [PROGRESS_PATH]: progressFile({ ...progress, step: 2, issues: { ...progress.issues, task2 } }),
    }));
    await gh.comment(pr.number, messages.merged1(task2));
  } else {
    const task3 = await gh.createIssue(messages.task3);
    await gh.commit(branch, transmission(2, 'Heron docked with a fault'), async (read) => ({
      [ARRIVALS_PATH]: appendLine(await read(ARRIVALS_PATH), line(SHIPS.heron)),
      [PROGRESS_PATH]: progressFile({ ...progress, step: 3, issues: { ...progress.issues, task3 } }),
    }));
    await gh.comment(pr.number, messages.merged2(task3));
  }
}

async function issueOpened(branch, progress) {
  const issue = event.issue;
  if (issue.number === progress.issues.task3) return;
  const isFault = issue.labels.some((label) => label.name === 'fault');
  if (!isFault) {
    if (event.action === 'opened') await gh.comment(issue.number, messages.faultNeedsTemplate);
    return;
  }

  // This transmission changes main after the learner last pulled, so their
  // push in step 4 is rejected until they bring it in.
  await gh.commit(branch, transmission(3, `fault #${issue.number} logged, Plover inbound`), async (read) => ({
    [ARRIVALS_PATH]: appendLine(await read(ARRIVALS_PATH), line(SHIPS.plover)),
    [PROGRESS_PATH]: progressFile({ ...progress, step: 4, issues: { ...progress.issues, fault: issue.number } }),
  }));
  await gh.comment(issue.number, messages.faultLogged(issue.number));
  await gh.comment(progress.issues.task3, messages.taskFiled(issue.number));
  await gh.setIssueState(progress.issues.task3, 'closed');
}

async function faultFixPushed(branch, progress) {
  const findings = inspectFaultFix(progress, {
    faults: showFile(event.after, FAULTS_PATH),
    messages: event.commits.map((commit) => commit.message),
    headCommitterEmail: event.head_commit?.committer?.email,
  });
  const fault = progress.issues.fault;
  if (!passed(findings)) {
    await gh.setIssueState(fault, 'open'); // a "Fixes #" may have closed it
    await gh.upsertComment(fault, FAULT_MARKER, report('Fault check', findings));
    return console.log(report('Fault check', findings));
  }
  await gh.commit(branch, transmission(4, 'mission complete'), async () => ({
    [PROGRESS_PATH]: progressFile({ ...progress, step: 5, complete: true }),
  }));
  await gh.upsertComment(fault, FAULT_MARKER, report('Fault check', findings));
  await gh.comment(fault, messages.complete(fault));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
