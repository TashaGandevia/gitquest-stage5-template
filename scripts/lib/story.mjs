// The stage's steps and the rules each proposal is inspected against. Pure
// functions only: station.mjs and checks.mjs gather the evidence from Git and
// the GitHub event, then ask this file what it means.
//
// Step 0  not started        → Run workflow opens the M14 task
// Step 1  M14 Aster plan     → valid merge → hold notice on main, M15 task
// Step 2  M15 handover       → discrepancy filed + valid merge → release notices,
//                              bot opens the review pull request
// Step 3  M16 review         → Request changes → bot corrects → approve, merge
// Step 4  M16 repair         → only if the review PR merged before correction
// Step 5  M16 final handover → valid merge → complete
// Step 6  complete

import {
  ARRIVALS_PATH,
  HANDOVER_PATH,
  PLAN_PATH,
  PROTECTED_PATHS,
  REPORT_PATH,
  T,
  WEB_COMMITTER_EMAIL,
} from './config.mjs';
import { ASTER, ASTER_ARRIVAL } from './content.mjs';
import { TIME, hasEntry, parseArrivals, parseFields, parseReport, sections } from './records.mjs';

export const STEP = { NOT_STARTED: 0, PLAN: 1, HANDOVER: 2, REVIEW: 3, REPAIR: 4, FINAL: 5, COMPLETE: 6 };

export function initialProgress() {
  return { schema: 4, step: STEP.NOT_STARTED, steps: {}, issues: {}, prs: {}, review: {}, chunk: null, complete: false };
}

// Every step is its own small issue, opened when the step before it is done.
// `progress.steps` maps a step key to its issue number.
// 16.R replaces 16.2 when Mika's pull request merged before the correction.
export const MISSION_STEPS = {
  m14: ['14.1', '14.2', '14.3'],
  m15: ['15.1', '15.2', '15.3', '15.4'],
  m16: ['16.1', '16.2', '16.3', '16.4'],
};

// The step whose issue the learner's pull request closes, for each part of
// the story: the step in which they open that pull request.
export const LINK_STEP = { [STEP.PLAN]: '14.2', [STEP.HANDOVER]: '15.1', [STEP.REPAIR]: '16.R', [STEP.FINAL]: '16.3' };
export const linkIssue = (progress, step = progress.step) => progress.steps?.[LINK_STEP[step]];

export const missionOf = (key) => `m${key.split('.')[0]}`;

export function stepOrder(progress, mission) {
  const order = MISSION_STEPS[mission];
  return mission === 'm16' && progress.review?.repair ? order.map((k) => (k === '16.2' ? '16.R' : k)) : order;
}

// Every step of the stage, in order.
export const allSteps = (progress) => Object.keys(MISSION_STEPS).flatMap((m) => stepOrder(progress, m));

// True when `target` comes after the current step. Steps only move forward.
export function isAhead(progress, target) {
  if (!progress.chunk) return true;
  const order = allSteps(progress);
  return order.indexOf(target) > order.indexOf(progress.chunk);
}

// The one record file each learner task changes.
const TASK_FILE = { [STEP.PLAN]: PLAN_PATH, [STEP.HANDOVER]: HANDOVER_PATH, [STEP.REPAIR]: REPORT_PATH, [STEP.FINAL]: HANDOVER_PATH };

export const PART_TITLES = {
  plan: 'Validate arrival plan',
  handover: 'Validate handover',
  records: 'Validate arrivals and report',
  proposal: 'Validate links and paths',
};

export const PLAN_FIELDS = ['Ship', 'Date', 'Expected', 'Proposed bay', 'Status', 'Condition'];
export const HANDOVER_FIELDS = ['Ship', 'Expected', 'Bay', 'Bay status', 'Instruction'];
export const BAY_STATUSES = ['Hold', 'Released'];
export const SUMMARY_HEADINGS = ['Outcome', 'Evidence', 'Outstanding work'];

// GitHub's closing keywords, for this issue number only.
export function linksIssue(text, number) {
  if (!number) return false;
  return new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s*:?\\s+#${number}\\b`, 'i').test(text ?? '');
}

export const mentionsIssue = (text, number) => Boolean(number) && new RegExp(`#${number}\\b`).test(text ?? '');

// The instruction is explicit when it says the bay is held or must be released first.
export const instructionIsExplicit = (instruction) => /\b(releas\w*|hold|held|on hold)\b/i.test(instruction ?? '');

// A review names the evidence when it gives Maintenance's release time.
export const namesReleaseTime = (text) => /\b22[:.]25\b/.test(text ?? '');

// A finding is one inspected rule. `kind` says what a failure means:
//   content - the record itself is wrong; a merge with this failure does not count
//   link    - a closing keyword is missing; station control closes the issue itself
//   history - the branch is missing station changes; a merge brings them in
//   record  - something outside the pull request (an issue) is still missing
//   advice  - worth saying, never fails a check
function collector() {
  const findings = [];
  const add = (ok, id, kind, text, extra = {}) => findings.push({ ok, id, kind, text, ...extra });
  return { findings, add };
}

const fieldLine = (name, value) => `${name}: ${value ?? ''}`.trim();

function diagnostic(id, path, line, found, hint) {
  return [`FAIL ${id}`, line ? `${path}:${line}` : path, found, hint].filter(Boolean);
}

// ---------------------------------------------------------------- M14 plan

function inspectPlan(text, add) {
  if (text == null) {
    return add(false, 'plan-file', 'content', `\`${PLAN_PATH}\` is missing`, {
      diagnostic: diagnostic('plan-file', PLAN_PATH, null, null, 'Restore the plan file from main and edit only its Expected time.'),
    });
  }
  const { fields, lines } = parseFields(text, PLAN_FIELDS);
  const missing = PLAN_FIELDS.filter((name) => !fields[name]);
  add(missing.length === 0, 'plan-fields', 'content',
    missing.length === 0 ? 'Every plan field is filled in' : `The plan is missing: ${missing.map((m) => `\`${m}:\``).join(', ')}`,
    missing.length ? { diagnostic: diagnostic('plan-fields', PLAN_PATH, null, `Missing: ${missing.join(', ')}`, `Keep every labelled field: ${PLAN_FIELDS.join(', ')}.`) } : {});

  const expected = fields.Expected;
  if (expected && !TIME.test(expected)) {
    add(false, 'plan-time', 'content', `Expected time \`${expected}\` should be 24-hour \`HH:MM\``, {
      diagnostic: diagnostic('plan-time', PLAN_PATH, lines.Expected, fieldLine('Expected', expected), `Use a 24-hour time in HH:MM form, for example ${ASTER.time}.`),
    });
  } else {
    add(expected === ASTER.time, 'plan-expected', 'content',
      expected === ASTER.time ? `Expected time is ${ASTER.time}` : `Expected time should be ${ASTER.time}, the revised time in Mika's request`,
      expected === ASTER.time ? {} : { diagnostic: diagnostic('plan-expected', PLAN_PATH, lines.Expected, fieldLine('Expected', expected), `Mika's request moves Aster from ${ASTER.oldTime} to ${ASTER.time}.`) });
  }

  add(fields.Status === 'Planned', 'plan-status', 'content',
    fields.Status === 'Planned' ? 'Status remains Planned' : 'Status should stay `Planned`: the ship isn\'t here yet',
    fields.Status === 'Planned' ? {} : { diagnostic: diagnostic('plan-status', PLAN_PATH, lines.Status, fieldLine('Status', fields.Status), 'A plan is not an arrival record. Keep Status: Planned.') });

  const conditionKept = /maintenance/i.test(fields.Condition ?? '') && /releas/i.test(fields.Condition ?? '');
  add(conditionKept, 'plan-condition', 'content',
    conditionKept ? 'The Maintenance condition is present' : 'Keep the condition that the berth depends on Maintenance releasing Bay 3',
    conditionKept ? {} : { diagnostic: diagnostic('plan-condition', PLAN_PATH, lines.Condition, fieldLine('Condition', fields.Condition), 'Leave the Condition line as it was on main.') });

  const unchanged = fields.Ship === ASTER.ship && fields.Date === ASTER.date && fields['Proposed bay'] === ASTER.bay;
  add(unchanged, 'plan-unchanged', 'content',
    unchanged ? 'Ship, date and proposed bay are unchanged' : `Only the expected time changes. Ship should be ${ASTER.ship}, Date ${ASTER.date}, Proposed bay ${ASTER.bay}`);
}

// ---------------------------------------------------------------- handover

export function findSection(text, name) {
  for (const level of [2, 3, 4]) {
    const all = sections(text, level);
    const key = Object.keys(all).find((heading) => heading.toLowerCase() === name.toLowerCase());
    if (key !== undefined) return all[key];
  }
  return null;
}

// The `## Night shift` block. `requireHold` is true in M15, while Bay 3 is held.
function inspectNightShift(text, add, { requireHold }) {
  const night = text == null ? null : sections(text)['Night shift'];
  if (night == null) {
    return add(false, 'handover-section', 'content', `\`${HANDOVER_PATH}\` needs its \`## Night shift\` heading`, {
      diagnostic: diagnostic('handover-section', HANDOVER_PATH, null, null, 'Put the handover block under the existing "## Night shift" heading.'),
    });
  }
  // Line numbers relative to the whole file, for diagnostics.
  const offset = text.replace(/\r\n/g, '\n').split('\n').findIndex((l) => l.trim() === '## Night shift') + 1;
  const { fields, lines } = parseFields(night, HANDOVER_FIELDS);
  const at = (name) => (lines[name] ? lines[name] + offset : null);

  const missing = HANDOVER_FIELDS.filter((name) => !fields[name]);
  add(missing.length === 0, 'handover-fields', 'content',
    missing.length === 0 ? 'The night-shift block has every field' : `The night-shift block is missing: ${missing.map((m) => `\`${m}:\``).join(', ')}`,
    missing.length ? { diagnostic: diagnostic('handover-fields', HANDOVER_PATH, null, `Missing: ${missing.join(', ')}`, `Each field goes on its own line: ${HANDOVER_FIELDS.map((f) => `${f}: ...`).join(' / ')}.`) } : {});

  const expected = fields.Expected;
  if (expected !== undefined && !TIME.test(expected)) {
    add(false, 'handover-time', 'content', `Expected time \`${expected}\` should be 24-hour \`HH:MM\``, {
      diagnostic: diagnostic('handover-time', HANDOVER_PATH, null, fieldLine('Expected', expected), `Use a 24-hour time in HH:MM form, for example ${ASTER.time}.`),
      line: at('Expected'),
    });
  } else if (expected !== undefined) {
    add(expected === ASTER.time, 'handover-expected', 'content',
      expected === ASTER.time ? `Expected time is ${ASTER.time}` : `Expected time should be ${ASTER.time}, as in the merged plan`,
      expected === ASTER.time ? {} : { diagnostic: diagnostic('handover-expected', HANDOVER_PATH, at('Expected'), fieldLine('Expected', expected), `The merged plan in ${PLAN_PATH} says ${ASTER.time}.`) });
  }

  const bayOk = /^(Bay )?3$/.test(fields.Bay ?? '');
  if (fields.Bay !== undefined) {
    add(bayOk && fields.Ship === ASTER.ship, 'handover-ship', 'content',
      bayOk && fields.Ship === ASTER.ship ? 'Ship is Aster, at Bay 3' : 'The block should be for Ship: Aster at Bay: 3');
  }

  const status = fields['Bay status'];
  if (status !== undefined) {
    const known = BAY_STATUSES.includes(status);
    const ok = known && (!requireHold || status === 'Hold');
    add(ok, 'handover-bay-status', 'content',
      ok ? `Bay status is ${status}` : known ? 'Bay status should be `Hold`: Maintenance has not released Bay 3' : `Bay status \`${status}\` should be one of ${BAY_STATUSES.join(', ')}`,
      ok ? {} : { diagnostic: diagnostic('handover-bay-status', HANDOVER_PATH, at('Bay status'), fieldLine('Bay status', status), `Accepted values: ${BAY_STATUSES.join(', ')}.`) });
  }
  return fields;
}

function inspectSummary(text, add, progress) {
  const found = Object.fromEntries(SUMMARY_HEADINGS.map((name) => [name, text == null ? null : findSection(text, name)]));
  const missing = SUMMARY_HEADINGS.filter((name) => found[name] == null);
  add(missing.length === 0, 'summary-headings', 'content',
    missing.length === 0 ? 'The summary has Outcome, Evidence and Outstanding work' : `Add these headings to the handover: ${missing.map((m) => `\`### ${m}\``).join(', ')}`,
    missing.length ? { diagnostic: diagnostic('summary-headings', HANDOVER_PATH, null, `Missing: ${missing.join(', ')}`, 'Add a "## Summary" section with ### Outcome, ### Evidence and ### Outstanding work.') } : {});
  if (missing.length) return;

  const summary = SUMMARY_HEADINGS.map((name) => found[name]).join('\n');
  const timesOk = summary.includes(ASTER.release) && summary.includes(ASTER.time);
  add(timesOk, 'summary-times', 'content',
    timesOk ? `The summary gives the release (${ASTER.release}) and the arrival (${ASTER.time})` : `The summary should give both times: Maintenance released Bay 3 at ${ASTER.release}; Aster docked at ${ASTER.time}`,
    timesOk ? {} : { diagnostic: diagnostic('summary-times', HANDOVER_PATH, null, null, `Check both notices: release ${ASTER.release}, arrival ${ASTER.time}.`) });
  // The first time after each "released" is the release time it claims.
  const contradictory = [...summary.matchAll(/released\D*?(\d{1,2}[:.]\d{2})/gi)].some((m) => m[1].replace('.', ':') === ASTER.time);
  if (contradictory) {
    add(false, 'summary-release', 'content', `The summary says the bay was released at ${ASTER.time}. Maintenance released it at ${ASTER.release}`);
  }

  const { discrepancy } = progress.issues;
  const reviewPr = progress.prs.review;
  const cited = [discrepancy, reviewPr].filter(Boolean);
  const citesAll = cited.every((n) => mentionsIssue(found.Evidence, n));
  add(citesAll, 'summary-evidence', 'content',
    citesAll ? `Evidence links ${cited.map((n) => `#${n}`).join(' and ')}` : `Under Evidence, link the discrepancy issue and the arrival pull request: ${cited.map((n) => `#${n}`).join(' and ')}`);

  const outstanding = (found['Outstanding work'] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  add(outstanding !== '', 'summary-outstanding', 'content',
    outstanding !== '' ? 'Outstanding work is stated' : 'Say what work remains under Outstanding work, even if it is "None"');
}

// ---------------------------------------------------------------- arrivals and report

function inspectRecords(files, add, { factual }) {
  const arrivals = parseArrivals(files[ARRIVALS_PATH]);
  add(arrivals.problems.length === 0, 'arrivals-format', 'content',
    arrivals.problems.length === 0 ? `\`${ARRIVALS_PATH}\` follows the arrival format` : `\`${ARRIVALS_PATH}\` has format problems:\n${arrivals.problems.map((p) => `  - ${p}`).join('\n')}`,
    arrivals.problems.length ? { diagnostic: ['FAIL arrivals-format', ARRIVALS_PATH, ...arrivals.problems, 'Format: YYYY-MM-DD HH:MM | Ship | Bay N'] } : {});
  const aster = { date: ASTER.date, time: ASTER.time, ship: ASTER.ship, bay: ASTER.bay };
  add(hasEntry(arrivals.entries, aster), 'arrivals-aster', 'content',
    hasEntry(arrivals.entries, aster) ? `Aster's arrival is recorded as \`${ASTER_ARRIVAL}\`` : `Aster's arrival should be recorded as \`${ASTER_ARRIVAL}\``);

  const text = files[REPORT_PATH];
  const report = parseReport(text);
  const headings = ['Discrepancy', 'Evidence', 'Resolution'];
  const missing = text == null ? headings : headings.filter((h) => !(h in report.sections));
  add(missing.length === 0, 'report-structure', 'content',
    missing.length === 0 ? 'The bay report has Discrepancy, Evidence and Resolution' : `\`${REPORT_PATH}\` is missing: ${missing.map((m) => `\`## ${m}\``).join(', ')}`);

  const shaped = report.release && report.docked && TIME.test(report.release) && TIME.test(report.docked);
  add(Boolean(shaped), 'report-lines', 'content',
    shaped ? 'The report states a release time and an arrival time in HH:MM form' : 'The report needs "Maintenance released Bay 3 at HH:MM." and "Aster docked at HH:MM."',
    shaped ? {} : { diagnostic: diagnostic('report-lines', REPORT_PATH, null, `Release: ${report.release ?? 'missing'} / Docked: ${report.docked ?? 'missing'}`, 'Use 24-hour HH:MM times.') });

  if (factual && shaped) {
    add(report.release === ASTER.release, 'report-release', 'content',
      report.release === ASTER.release ? `Release time agrees with Maintenance's notice (${ASTER.release})` : `Release time should be ${ASTER.release}, from Maintenance's notice`,
      report.release === ASTER.release ? {} : { diagnostic: diagnostic('report-release', REPORT_PATH, null, `Maintenance released Bay 3 at ${report.release}.`, `Maintenance's 22:25 notice records the release at ${ASTER.release}.`) });
    add(report.docked === ASTER.time, 'report-docked', 'content',
      report.docked === ASTER.time ? `Arrival time agrees with Docking's confirmation (${ASTER.time})` : `Arrival time should be ${ASTER.time}`);
  }
}

// ---------------------------------------------------------------- the proposal itself

function inspectProposal(progress, pr, add) {
  const step = progress.step;
  const allowed = [TASK_FILE[step]];
  const touched = pr.changedPaths.filter((path) => PROTECTED_PATHS.some((p) => path === p || path.startsWith(p)));
  const extra = pr.changedPaths.filter((path) => !allowed.includes(path) && !touched.includes(path));
  add(touched.length === 0, 'proposal-protected', 'content',
    touched.length === 0 ? 'No station equipment or notices changed' : `Leave station equipment and notices alone. These changed: ${touched.map((p) => `\`${p}\``).join(', ')}`);
  add(extra.length === 0, 'proposal-paths', 'content',
    extra.length === 0 ? `Only \`${allowed[0]}\` changed` : `This task changes only \`${allowed[0]}\`. Also changed: ${extra.map((p) => `\`${p}\``).join(', ')}`);
  add(pr.changedPaths.includes(allowed[0]), 'proposal-changed', 'content',
    pr.changedPaths.includes(allowed[0]) ? `\`${allowed[0]}\` is changed` : `This proposal doesn't change \`${allowed[0]}\` yet`);

  const issue = linkIssue(progress, step);
  add(linksIssue(pr.body, issue), 'proposal-link', 'link',
    linksIssue(pr.body, issue) ? `The description closes #${issue}` : `The description should say \`Closes #${issue}\` so that issue closes when this merges`);

  if (step === STEP.HANDOVER) {
    const ok = Boolean(pr.transmissions?.[T.holdNotice]);
    add(ok, 'proposal-notice', 'history',
      ok ? "The branch includes Maintenance's 18:15 notice" : "The branch is missing Maintenance's 18:15 notice from main. Run `git switch main`, `git pull`, `git switch -` and `git merge main`, then push");
  }
  if (step === STEP.FINAL) {
    const ok = parseReport(pr.files[REPORT_PATH]).release === ASTER.release;
    add(ok, 'proposal-report', 'history',
      ok ? 'The branch includes the corrected bay report' : 'The branch is missing the merged arrival and corrected report. Pull main, then merge it into your branch and push');
  }

  const fromWeb = pr.committerEmails.some((email) => email === WEB_COMMITTER_EMAIL);
  if (fromWeb) {
    add(false, 'proposal-local', 'advice', 'A commit looks like it was made on GitHub\'s website. This stage is practice for committing on your own computer and pushing');
  }
}

// The pull request a GitHub "Revert" pull request undoes, or null. GitHub's
// Revert button names the branch revert-<n>-<branch> and writes "Reverts owner/repo#<n>".
export function revertOf(pr) {
  const fromBody = (pr.body ?? '').match(/\bReverts\s+[\w.-]+\/[\w.-]+#(\d+)/);
  const fromBranch = (pr.headRef ?? pr.head?.ref ?? '').match(/^revert-(\d+)-/);
  const match = fromBody ?? fromBranch;
  return match ? Number(match[1]) : null;
}

// `pr`: { number, isBot, body, files: { [path]: text|null }, changedPaths, committerEmails, transmissions }.
// Returns null when no task takes this pull request, else { task, parts, readiness, scope }.
export function evaluatePullRequest(progress, pr) {
  const step = progress.step;
  const parts = [];
  const part = (id, fill) => {
    const { findings, add } = collector();
    fill(add);
    parts.push({ id, title: PART_TITLES[id], findings });
  };

  if (pr.number === progress.prs.review) {
    if (step !== STEP.REVIEW) return null;
    part('records', (add) => inspectRecords(pr.files, add, { factual: false }));
    part('proposal', (add) => {
      const extra = pr.changedPaths.filter((p) => p !== ARRIVALS_PATH && p !== REPORT_PATH);
      add(extra.length === 0, 'proposal-paths', 'content',
        extra.length === 0 ? 'Only the arrival log and bay report changed' : `Unexpected changes: ${extra.join(', ')}`);
    });
    return {
      task: null,
      review: true,
      parts,
      readiness: null,
      scope: 'Record checks validate structure: the arrival format, the report headings and that each time is HH:MM. They do not compare the report with the notices. That is the reviewer\'s job.',
    };
  }

  if (pr.isBot || !LINK_STEP[step] || revertOf(pr)) return null;

  if (step === STEP.PLAN) part('plan', (add) => inspectPlan(pr.files[PLAN_PATH], add));
  if (step === STEP.HANDOVER) part('handover', (add) => inspectNightShift(pr.files[HANDOVER_PATH], add, { requireHold: true }));
  if (step === STEP.REPAIR) part('records', (add) => inspectRecords(pr.files, add, { factual: true }));
  if (step === STEP.FINAL) {
    part('handover', (add) => {
      inspectNightShift(pr.files[HANDOVER_PATH], add, { requireHold: false });
      inspectSummary(pr.files[HANDOVER_PATH], add, progress);
    });
  }
  part('proposal', (add) => inspectProposal(progress, pr, add));

  return {
    task: linkIssue(progress, step),
    review: false,
    parts,
    readiness: step === STEP.HANDOVER ? readiness(progress, pr, parts) : null,
    scope: 'Record checks validate the record format, required fields, allowed paths and the link to your task. They cannot judge what a sentence will mean to the next shift.',
  };
}

// M15's second result: what a reader needs beyond the format rules.
function readiness(progress, pr, parts) {
  const { findings, add } = collector();
  const formatOk = parts.every((p) => p.findings.every((f) => f.ok || f.kind === 'advice' || f.kind === 'history' || f.kind === 'link'));
  add(formatOk, 'readiness-checks', 'content', formatOk ? 'Record checks pass for this revision' : 'Record checks must pass first');

  const night = pr.files[HANDOVER_PATH] == null ? null : sections(pr.files[HANDOVER_PATH])['Night shift'];
  const instruction = night == null ? null : parseFields(night, HANDOVER_FIELDS).fields.Instruction;
  const explicit = instructionIsExplicit(instruction);
  add(explicit, 'readiness-instruction', 'content',
    explicit ? 'The instruction makes the Bay 3 hold explicit' : 'The instruction should say that preparing Bay 3 waits for Maintenance to release it');

  const discrepancy = progress.issues.discrepancy;
  add(Boolean(discrepancy), 'readiness-discrepancy', 'record',
    discrepancy ? `Discrepancy #${discrepancy} is on record` : 'A **Record discrepancy** issue has not been filed yet');
  if (discrepancy) {
    add(linksIssue(pr.body, discrepancy), 'readiness-link', 'link',
      linksIssue(pr.body, discrepancy) ? `The description fixes #${discrepancy}` : `Add \`Fixes #${discrepancy}\` to the description, alongside \`Closes #${linkIssue(progress, STEP.HANDOVER)}\``);
  }
  return findings;
}

// A completion code: CODE_LENGTH characters from CODE_ALPHABET. `randomInt`
// is crypto.randomInt in station control; tests can pass their own.
export function completionCode(randomInt, alphabet, length) {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export const allFindings = (evaluation) => [...evaluation.parts.flatMap((p) => p.findings), ...(evaluation.readiness ?? [])];
export const failing = (findings) => findings.filter((f) => !f.ok && f.kind !== 'advice');
export const passed = (findings) => failing(findings).length === 0;
export const blocking = (findings) => findings.filter((f) => !f.ok && f.kind === 'content');
export const partPassed = (part) => passed(part.findings);
export const checksPassed = (evaluation) => evaluation.parts.every(partPassed);

// ---------------------------------------------------------------- discrepancy issue form

// Issue forms render each field as `### Label` followed by the answer.
export function parseIssueForm(body) {
  const fields = {};
  for (const [label, value] of Object.entries(sections(body ?? '', 3))) {
    const text = value.trim();
    fields[label] = text === '_No response_' ? '' : text;
  }
  return fields;
}

export function inspectDiscrepancy(body) {
  const form = parseIssueForm(body);
  const { findings, add } = collector();
  const file = form.File ?? '';
  const location = form.Location ?? '';
  const observed = form.Observed ?? '';
  const evidence = `${form.Evidence ?? ''}\n${form['Evidence details'] ?? ''}`;
  add(file.includes('handover/2085-12-08.md'), 'discrepancy-file', 'content', file.includes('handover/2085-12-08.md') ? 'Names the handover file' : 'File: name `docking-log/handover/2085-12-08.md`');
  const pr = location.match(/#(\d+)/);
  add(Boolean(pr), 'discrepancy-location', 'content', pr ? `Points to pull request #${pr[1]}` : 'Location: name the field and the pull request it was proposed in, for example `Instruction field, PR #12`');
  add(/prepare bay 3/i.test(observed), 'discrepancy-observed', 'content', /prepare bay 3/i.test(observed) ? 'Quotes the instruction' : 'Observed: quote the sentence from the draft, "Prepare Bay 3 for Aster."');
  add((form.Expected ?? '') !== '', 'discrepancy-expected', 'content', (form.Expected ?? '') !== '' ? 'Says what it should say instead' : 'Expected: say what the instruction should make clear');
  add(evidence.includes('18:15'), 'discrepancy-evidence', 'content', evidence.includes('18:15') ? "Cites Maintenance's 18:15 notice" : "Evidence: choose Maintenance's 18:15 notice");
  return { findings, pullRequest: pr ? Number(pr[1]) : null };
}

// ---------------------------------------------------------------- reports

// Content failures are errors; anything that doesn't block a merge is a
// warning. Colours match GitQuest (COLOURS in messages.mjs).
const tag = (text, colour) => `\$\\color{${colour}}{\\textbf{${text}}}$`;
const ICON = { ok: '**Pass** ·', fail: `${tag('FAIL', '#FF8E98')} ·`, warn: `${tag('WARNING', '#F2C66D')} ·`, advice: `${tag('NOTE', '#F2C66D')} ·` };

export function renderFindings(findings) {
  return findings
    .map((f) => {
      const icon = f.ok ? ICON.ok : f.kind === 'advice' ? ICON.advice : f.kind === 'content' ? ICON.fail : ICON.warn;
      const detail = !f.ok && f.diagnostic ? `\n\n  \`\`\`text\n${f.diagnostic.map((l) => `  ${l}`).join('\n')}\n  \`\`\`` : '';
      return `- ${icon} ${f.text}${detail}`;
    })
    .join('\n');
}

// Plain text for a workflow log: PASS lines, and a full diagnostic per failure.
export function logFindings(findings) {
  return findings
    .map((f) => {
      if (f.ok) return `PASS ${f.id}`;
      if (f.kind === 'advice') return `NOTE ${f.id}: ${f.text.replace(/`/g, '')}`;
      return (f.diagnostic ?? [`FAIL ${f.id}`, f.text.replace(/`/g, '')]).join('\n');
    })
    .join('\n');
}
