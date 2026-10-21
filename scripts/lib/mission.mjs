// The mission's steps and the rules each one is inspected against. Pure
// functions: station.mjs gathers the evidence from Git and the event payload.
//
// Step 0  template, not started    → setup opens task 1
// Step 1  task 1: Kestrel (PR)     → merge passes → T1 adds Osprey on main, opens task 2
// Step 2  task 2: Osprey (pull+PR) → merge passes → T2 adds Heron, opens task 3
// Step 3  task 3: file a fault     → fault issue opened → T3 changes main, step 4
// Step 4  resolve fault (push)     → push to main passes → T4, step 5
// Step 5  complete

import { ARRIVALS_PATH, DEPARTURES_PATH, FAULTS_PATH, PROTECTED_PATHS, WEB_COMMITTER_EMAIL } from './config.mjs';
import { hasEntry, parseFaultLog, parseShipLog } from './log.mjs';

export const SHIPS = {
  wren: { name: 'Wren', status: 'Departed', time: '08:40' },
  kestrel: { name: 'Kestrel', status: 'Departed', time: '09:15' },
  ospreyInbound: { name: 'Osprey', status: 'Inbound', time: '10:30' },
  ospreyDocked: { name: 'Osprey', status: 'Docked', time: '10:42' },
  heron: { name: 'Heron', status: 'Docked', time: '11:05' },
  plover: { name: 'Plover', status: 'Inbound', time: '12:20' },
};

export const FAULT = { ship: 'Heron', fault: 'Docking clamp' };

export const line = ({ name, status, time }) => `${name} | ${status} | ${time}`;
export const faultLine = (issue, status) => `#${issue} | ${FAULT.ship} | ${FAULT.fault} | ${status}`;

export function initialProgress() {
  return { schema: 1, step: 0, issues: {} };
}

export function linksIssue(text, number) {
  return new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${number}\\b`, 'i').test(text ?? '');
}

function logFindings(check, path, parsed) {
  check(
    parsed.problems.length === 0,
    parsed.problems.length === 0
      ? `\`${path}\` follows the log format`
      : `\`${path}\` has format problems:\n${parsed.problems.map((p) => `  - ${p}`).join('\n')}`,
  );
}

// `pr`: { body, files: { [path]: text }, changedPaths, committerEmails, containsTransmission }.
// Returns null when the current step doesn't take a pull request.
export function inspectPullRequest(progress, pr) {
  const findings = [];
  const check = (ok, text) => findings.push({ ok, text });
  const issue = progress.issues[`task${progress.step}`];

  if (progress.step === 1) {
    const log = parseShipLog(pr.files[DEPARTURES_PATH]);
    logFindings(check, DEPARTURES_PATH, log);
    check(hasEntry(log.entries, SHIPS.kestrel), `Kestrel's departure is logged as \`${line(SHIPS.kestrel)}\``);
    check(hasEntry(log.entries, SHIPS.wren), `Wren's departure is still in the log`);
  } else if (progress.step === 2) {
    const log = parseShipLog(pr.files[ARRIVALS_PATH]);
    logFindings(check, ARRIVALS_PATH, log);
    check(
      pr.containsTransmission,
      pr.containsTransmission
        ? `Your branch includes station control's latest change to \`main\``
        : `Your branch is missing station control's latest change to \`main\`. Pull \`main\` on your machine, then bring it into your branch and push again`,
    );
    check(hasEntry(log.entries, SHIPS.ospreyDocked), `Osprey is logged as \`${line(SHIPS.ospreyDocked)}\``);
    check(!hasEntry(log.entries, SHIPS.ospreyInbound), `Osprey's old \`Inbound\` line has been replaced`);
  } else {
    return null;
  }

  check(
    linksIssue(pr.body, issue),
    linksIssue(pr.body, issue)
      ? `The description closes #${issue}`
      : `The description should say \`Closes #${issue}\` so the task closes when this merges`,
  );

  const touched = pr.changedPaths.filter((path) => PROTECTED_PATHS.some((p) => path === p || path.startsWith(p)));
  check(
    touched.length === 0,
    touched.length === 0
      ? `Only the docking log changed`
      : `Leave station equipment alone. These changed: ${touched.map((p) => `\`${p}\``).join(', ')}`,
  );

  const fromWeb = pr.committerEmails.some((email) => email === WEB_COMMITTER_EMAIL);
  check(
    pr.committerEmails.length > 0 && !fromWeb,
    fromWeb
      ? `A commit was made on GitHub (web editor or "Update branch"). Make and push commits from your own clone`
      : `Commits were made on your machine and pushed`,
  );

  return findings;
}

// `push`: { faults, messages, headCommitterEmail }. Step 4 only.
export function inspectFaultFix(progress, push) {
  const findings = [];
  const check = (ok, text) => findings.push({ ok, text });
  const issue = progress.issues.fault;
  const log = parseFaultLog(push.faults);
  const resolved = { issue, ship: FAULT.ship, fault: FAULT.fault, status: 'Resolved' };

  logFindings(check, FAULTS_PATH, log);
  check(hasEntry(log.entries, resolved), `Fault #${issue} is logged as \`${faultLine(issue, 'Resolved')}\``);
  check(
    push.messages.some((message) => linksIssue(message, issue)),
    `A pushed commit message says \`Fixes #${issue}\``,
  );
  check(
    push.headCommitterEmail !== WEB_COMMITTER_EMAIL,
    push.headCommitterEmail === WEB_COMMITTER_EMAIL
      ? `This came from GitHub's website. Commit on your machine and push \`main\``
      : `Pushed from your machine`,
  );
  return findings;
}

export const passed = (findings) => findings.every((finding) => finding.ok);

export function report(title, findings) {
  const verdict = passed(findings) ? 'passed' : 'needs attention';
  const items = findings.map(({ ok, text }) => `- ${ok ? '✅' : '❌'} ${text}`).join('\n');
  return `### ${title}: ${verdict}\n\n${items}`;
}
