#!/usr/bin/env node
// Record checks: inspects one pull request revision in readable steps.
//
//   node scripts/checks.mjs gather            read the proposal and decide what applies
//   node scripts/checks.mjs validate <part>   one workflow step per part; fails on a problem
//   node scripts/checks.mjs report            post the summary comment and statuses
//
// Each step reads what `gather` wrote, so a failed step never hides the others.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROGRESS_PATH, TEMPLATE_REPOSITORY } from './lib/config.mjs';
import { collectPullRequest } from './lib/evidence.mjs';
import { createClient } from './lib/github.mjs';
import { MARKERS, publishInspection } from './lib/inspection.mjs';
import * as messages from './lib/messages.mjs';
import { STEP, evaluatePullRequest, revertOf, failing, initialProgress, logFindings } from './lib/story.mjs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const eventName = process.env.GITHUB_EVENT_NAME;
const repository = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const runUrl = `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
const statePath = join(process.env.RUNNER_TEMP ?? '.', 'gitquest-inspection.json');
const gh = createClient({ token: process.env.GITHUB_TOKEN, repository, apiUrl: process.env.GITHUB_API_URL });

const dispatched = eventName === 'workflow_dispatch';
const prNumber = () => (dispatched ? Number(event.inputs?.pull_request) : event.pull_request?.number);

async function gather() {
  if (repository === TEMPLATE_REPOSITORY) return writeFileSync(statePath, JSON.stringify({ offline: true }));
  const repo = await gh.repository();
  if (repo.is_template) return writeFileSync(statePath, JSON.stringify({ offline: true }));
  const text = await gh.readFile(PROGRESS_PATH, repo.default_branch);
  const progress = text ? JSON.parse(text) : initialProgress();

  const pr = dispatched ? await gh.getPullRequest(prNumber()) : event.pull_request;
  const evidence = collectPullRequest(pr, repo.default_branch);
  const evaluation = evaluatePullRequest(progress, evidence);

  console.log(`Pull request #${pr.number}, revision ${evidence.headSha.slice(0, 7)}, triggered by ${eventName}${event.action ? `.${event.action}` : ''}.`);
  console.log(`Changed: ${evidence.changedPaths.join(', ') || 'nothing'}`);
  console.log(evaluation ? `Inspecting against step ${progress.step}.` : 'No task takes this pull request right now.');
  writeFileSync(statePath, JSON.stringify({ progress, evidence, evaluation }));
}

function validate(partId) {
  if (!existsSync(statePath)) return console.log('The proposal was not gathered. See the "Gather proposal" step.');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const part = state.evaluation?.parts.find((p) => p.id === partId);
  if (!part) return console.log('Not part of the current task.');
  console.log(logFindings(part.findings));
  if (failing(part.findings).length > 0) process.exitCode = 1;
}

function currentTask(progress) {
  if (progress.step === STEP.REVIEW && progress.prs.review) return `reviewing pull request #${progress.prs.review}`;
  const issue = progress.steps?.[progress.chunk];
  return issue ? `#${issue}` : null;
}

async function report() {
  const number = prNumber();
  if (!existsSync(statePath)) {
    // Gathering failed: a fault in the station's workflow, not the learner's record.
    if (number) await gh.upsertComment(number, MARKERS.inspection, messages.stationFault(runUrl));
    process.exitCode = 1;
    return;
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.offline) return console.log('Template repository: station control stays offline.');
  if (!state.evaluation) {
    const reverted = revertOf(state.evidence ?? {});
    await gh.upsertComment(number, MARKERS.inspection, reverted ? messages.revertNotInspected(reverted) : messages.noTaskNeedsPullRequest(currentTask(state.progress)));
    return;
  }
  await publishInspection({
    gh,
    progress: state.progress,
    evaluation: state.evaluation,
    pr: state.evidence,
    runUrl,
    statusForChecks: dispatched,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${messages.inspectionReport({
      evaluation: state.evaluation,
      sha: state.evidence.headSha,
      runUrl,
      passedAll: state.evaluation.parts.every((p) => failing(p.findings).length === 0),
    })}\n`);
  }
}

const [command, arg] = process.argv.slice(2);
const run = { gather, validate: () => validate(arg), report }[command];
if (!run) {
  console.error('Usage: checks.mjs gather | validate <part> | report');
  process.exitCode = 2;
} else {
  Promise.resolve(run()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
