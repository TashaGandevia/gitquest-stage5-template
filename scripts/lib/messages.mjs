// Everything station control says, on issues and pull requests.
//
// Every character line is a card: the name in GitQuest's colour, then the
// message, in a bordered table cell. Problems go in GitHub's Caution/Warning
// boxes. Task issues are laid out in missions.mjs; this file has the comments,
// Mika's pull request, the Record checks report and the shared command
// walkthroughs (first push, later pushes, opening a pull request).
//
// All characters are posted by the same Actions bot; the README says they
// are scripted training characters.

import { DOCKING_NOTICES_PATH, HANDOVER_PATH, MAINTENANCE_NOTICES_PATH, PLAN_PATH, REPORT_PATH } from './config.mjs';
import { ASTER, ROUGH_HANDOVER } from './content.mjs';
import { renderFindings } from './story.mjs';

// ---------------------------------------------------------------- layout helpers

// GitQuest's colours. GitHub strips CSS from comments, but its maths
// rendering accepts \\color{#RRGGBB}, so names and FAIL/WARNING labels are
// coloured that way.
export const COLOURS = {
  mika: '#CBBD6A',
  voss: '#D99D5B',
  system: '#39E7B1',
  error: '#FF8E98',
  warning: '#F2C66D',
};

export const CAST = {
  voss: { name: 'Voss', colour: COLOURS.voss },
  mika: { name: 'Mika', colour: COLOURS.mika },
  maintenance: { name: 'Maintenance', colour: COLOURS.system },
  docking: { name: 'Docking', colour: COLOURS.system },
  station: { name: 'Station Control', colour: COLOURS.system },
};

// A coloured bold word, e.g. coloured('FAIL', COLOURS.error).
export const coloured = (text, colour) => `\$\\color{${colour}}{\\textbf{${text}}}$`;

// Every line prefixed with "> ", so paragraphs and code blocks stay inside.
export const quote = (text) => text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');

// GitHub alerts: NOTE (blue), TIP (green), IMPORTANT (purple), WARNING (yellow), CAUTION (red).
export const alert = (type, text) => `> [!${type}]\n${quote(text)}`;

export const speakerLabel = (who) => `\$\\color{${CAST[who].colour}}{\\Large\\textbf{${CAST[who].name}}}$`;

// One chat message: a bordered card with the coloured name, then the words.
// `time` is the story's station clock; it isn't shown, but keeps each line
// in order when reading the code.
export const say = (who, time, body) => `<table>
<tr>
<td>

${speakerLabel(who)}

${body}

</td>
</tr>
</table>`;

export const block = (text, lang = 'text') => `\`\`\`${lang}\n${text}\n\`\`\``;
export const fold = (summary, body) => `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
const yourMove = (steps) => `#### Your move\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

// Hints in three levels, all inside one fold so they don't crowd the page.
export const stuck = (idea, where, steps) => fold('Stuck?', [
  fold('Hint 1 · The idea', idea),
  fold('Hint 2 · Where to look', where),
  fold('Hint 3 · Exact steps', steps),
].join('\n\n'));

export const sections = (...parts) => parts.filter(Boolean).join('\n\n');

// ---------------------------------------------------------------- walkthrough pieces

// Task bodies are written before GitHub gives the issue a number. Station
// control replaces this token with the real number straight after creating
// the issue, so learners can copy `Closes #1` exactly.
export const ISSUE_NUMBER = '{{issue}}';

// Where screenshots load from: .github/screenshots in the player's own copy.
// Station control fills this in when it creates the issue.
export const SCREENSHOTS = '{{screenshots}}';

export const bash = (text) => block(text, 'bash');

// The upstream lesson, taught in full on the first new branch.
export const firstPush = (branch) => `${bash(`git push -u origin ${branch}`)}

GitHub doesn't have \`${branch}\` yet. This command creates it there **and links the two**, so Git remembers where this branch goes. That link is called the branch's **upstream**.

${block(`your computer                      GitHub
  ${branch.padEnd(14)} ── git push -u ──►  ${branch}
                  (linked: "upstream")`)}

You need \`-u\` only the **first** time you push a new branch. After that, plain \`git push\` is enough.

${fold('Typed plain <code>git push</code> by mistake?', `Git stops and shows:

${block(`fatal: The current branch ${branch} has no upstream branch.
To push the current branch and set the remote as upstream, use

    git push --set-upstream origin ${branch}`)}

Nothing is lost. Run the command it suggests (\`--set-upstream\` is the long name for \`-u\`).`)}`;

// Later new branches: same command, one-line reminder.
export const newBranchPush = (branch) => `${bash(`git push -u origin ${branch}`)}

New branch, so the first push needs \`-u\` to link it to GitHub, just like last time.`;

// Pushing more commits to a branch that is already linked.
export const laterPush = (path, message) => `${bash(`git add ${path}
git commit -m "${message}"
git push`)}

No \`-u\` this time: this branch is already linked. The open pull request picks up the new commit by itself.`;

export const openPullRequest = (branch, closes) => `On GitHub, a yellow bar says **${branch} had recent pushes**. Choose **Compare & pull request**.

- Check it shows **base: \`main\`** ← **compare: \`${branch}\`**.
- In the description, type ${closes}.
- Choose **Create pull request**.

${fold('No yellow bar?', `Open **Pull requests → New pull request**, set **compare** to \`${branch}\`, then **Create pull request**.`)}`;

// ---------------------------------------------------------------- M14

// ---------------------------------------------------------------- story comments
// Characters only talk here. What to do next lives in the mission's current
// step issue; station control posts "Next step" whenever a new one opens.

export const mikaPlanReady = say('mika', '18:02', "That's the update I needed. You've changed the expected time and left the condition in place. Ready to merge.");

export const planMerged = sections(
  say('voss', '18:10', 'The issue holds the request. The pull request holds the change and the conversation. Now both point to the finished work.'),
  say('mika', '18:11', 'GitHub has the merged plan. Your computer still has the old copy. Pull before you start the handover. Maintenance has sent something too.'),
);

export const vossFailedCheck = sections(
  say('voss', '18:40', 'The check found a problem in the draft. Open its details and read the failed step. The file and the value are both there.'),
  fold('What am I looking at?', `That result comes from **GitHub Actions**, which runs automatic jobs when something happens. This one runs whenever your pull request changes.

- A **run** has **jobs**; a job has **steps**. One step checks each kind of record.
- The top of the run shows what **triggered** it and which **commit** it tested.
- Checking every change automatically like this is called **continuous integration (CI)**.

Don't press **Re-run**: the same commit fails the same way. A new push starts a fresh run.`),
);

export const mikaSemanticReview = ({ caughtEarly, alreadyExplicit }) => {
  const opening = caughtEarly ? "You caught my time format before the inspector did. Good.\n\n" : '';
  return alreadyExplicit
    ? say('mika', '19:05', `${opening}You've already made the hold clear. Thanks.

My draft didn't, though, and the next shift should see why the wording changed. Can you record it as a discrepancy?`)
    : say('mika', '19:05', `${opening}The format's right. Read the instruction beside Maintenance's notice, though.

"Prepare Bay 3" could send the next shift down there before the hold is lifted. That's my wording. We should make the restriction explicit. Can you record it as a discrepancy, so the correction has a trail?`);
};

export const discrepancyAcknowledged = ({ issue, pr }) =>
  say('station', '19:28', `Discrepancy #${issue} is on record and linked to pull request #${pr}. It stays open until the correction merges.`);

export const vossDiscrepancy = say('voss', '19:30', "That's enough for someone else to follow: where it is, what it says, and why it needs changing. Put the correction on the branch you already have.");

export const discrepancyNeedsWork = (findings) => sections(
  say('station', '19:20', 'Almost. Edit this issue (**⋯ → Edit**) and fill in what\'s missing. No need for a new one.'),
  alert('WARNING', `**Missing from this report**\n\n${renderFindings(findings.filter((f) => !f.ok))}`),
);

export const discrepancyNeedsTemplate = say('station', '19:15', 'Station control only tracks record problems filed with the **Record discrepancy** form. Add the `record-discrepancy` label here, or open a new issue from that form.');

export const discrepancyAlreadyRecorded = (issue) => say('station', '19:35', `Discrepancy #${issue} is already on record for tonight. You can close this one.`);

export const mikaHandoverReady = say('mika', '20:10', "That says what the next shift needs. The berth is planned, the bay is on hold, and the condition is clear. Merge it.");

export const handoverMergedWaiting = say('station', '20:15', "The handover is merged and its records pass. One thing is missing: a **Record discrepancy** issue for Mika's original instruction. File it, and station control finishes the mission.");

export const handoverMerged = say('voss', '22:20', "The checks knew what a time should look like. They didn't know what a tired shift would make of that instruction. That's why someone reads the change.");

// Mika's pull request: story and evidence only. The steps are in M16.1.
export const reviewPullRequest = ({ discrepancy, handoverPr }) => ({
  title: 'Record Aster arrival and complete the bay report',
  body: sections(
    '# Comms',
    say('mika', '22:45', `Aster's in. I've put the arrival and the bay report in a pull request.

Your turn to read it. Compare the two times with the notices before you approve. One is when Maintenance released the bay; the other is when the ship arrived.`),
    '---',
    '# Notes',
    fold('Where this comes from', `Follows discrepancy #${discrepancy} and pull request #${handoverPr}. The notices are in \`${MAINTENANCE_NOTICES_PATH}\` and \`${DOCKING_NOTICES_PATH}\`.`),
    '<sub>Opened by station control on behalf of a scripted training character.</sub>',
  ),
});

export const reviewPermissionTask = {
  title: 'Station control needs permission to open a pull request',
  labels: ['task'],
  body: sections(
    '# Comms',
    say('station', '22:42', 'Station control tried to open Mika\'s pull request and GitHub said no.'),
    alert('WARNING', 'This is a repository setting, not a problem with your work. Nothing you\'ve done is lost.'),
    '# Your Tasks',
    '## Task 1',
    '- [ ] **Open the Actions settings**',
    quote('Open **Settings → Actions → General**.'),
    '## Task 2',
    '- [ ] **Allow Actions to open pull requests**',
    quote('Under **Workflow permissions**, choose **Read and write permissions** and tick **Allow GitHub Actions to create and approve pull requests**. Save.'),
    '## Task 3',
    '- [ ] **Run Station control again**',
    quote('Open **Actions → Station control → Run workflow**. It picks up where it stopped.'),
  ),
};

export const reviewNeedsTime = say('mika', '22:50', 'Thanks for reading it. Which time is wrong, and what should it be? Name the time from the notice and submit another **Request changes** review.');

export const reviewCorrected = say('mika', '22:55', `You're right. I copied the arrival time into both lines. Release is now ${ASTER.release}; arrival stays ${ASTER.time}. Thanks for checking the notice.`);

export const reviewApprovedFaulty = sections(
  say('mika', '22:50', 'Thanks. Before this goes in, put the report beside the notices with me:'),
  `| Line in the report | Notice | Notice says |
|---|---|---|
| Maintenance released Bay 3 at **22:40**. | Maintenance duty note | released at **${ASTER.release}** |
| Aster docked at **22:40**. | Docking arrival confirmation | secured at **${ASTER.time}** |`,
  'If a time is wrong, submit a new review with **Request changes** and say which one. It replaces your approval.',
);

export const reviewCommentNudge = say('station', '22:51', "That's the right catch. Make it a formal decision: **Files changed → Submit review → Request changes**, and say the same thing. Your comment stays.");

export const reviewChangesAfterCorrection = say('station', '22:58', `The current version says the bay was released at ${ASTER.release} and Aster docked at ${ASTER.time}, matching both notices. If you still see a problem, say what it is. Otherwise, approve it.`);

export const reviewApprovedStale = say('station', '22:58', 'That approval is for an older version. Mika has pushed a fix since: read the new diff, then approve the current one.');

export const reviewApproved = say('mika', '23:00', 'Approved. That records your decision on this version. Merging is a separate step.');

export const reviewMerged = ({ approved }) => sections(
  approved ? null : say('station', '23:08', "This merged without an approval of its final version. That's allowed here, but on a real team the approval is the record that someone checked. Next time: approve, then merge."),
  say('voss', '23:09', 'Recorded. One last thing: the handover.'),
);

export const reviewMergedEarly = say('station', '23:04', 'This merged before the release time was fixed. That\'s recoverable: the fix gets its own step and its own trail.');

export const reviewClosedUnmerged = say('station', '22:59', 'This pull request was closed without merging. Choose **Reopen pull request** below, or run **Actions → Station control → Run workflow**.');

// Posted the moment a learner opens a pull request, before any result is in.
export const waitForChecks = sections(
  say('station', 'now', 'Record checks is inspecting this pull request. It takes about a minute.'),
  alert('WARNING', '**Don\'t merge yet.** Wait for **Record checks** to finish and for someone on shift to reply. A green tick next to **Station control** only means the story was updated: it is not a check of your record.'),
);

// Record checks on a GitHub "Revert" pull request: not inspected as a task.
export const revertNotInspected = (reverted) => say('station', 'Record checks', `This pull request undoes #${reverted}, so it isn't inspected as a task. Voss explains below.`);

// Posted on the pull request that moved the story on.
export const nextStep = (mission, title) => say('station', 'next', `**Next step:** ${title}, in #${mission}.`);

export const vossFinalReady = say('voss', '23:30', 'The arrival is recorded, the release time agrees with Maintenance, and the handover links back to the correction. Put it in.');

export const stageComplete = (report) => sections(
  say('mika', '23:55', "Relief's here. They asked about Bay 3. I sent them the handover and they found the rest from there.\n\nWhich means, for once, I can actually leave."),
  say('voss', '23:56', "When you started, we couldn't say when a line had disappeared. Tonight, someone can follow the request, the correction, the review, and the record it became.\n\nThat's a handover."),
  say('station', '23:59', `**Stage complete.** The December 8 shift pack is complete. Your three badges are at the top of the README, and your GitQuest code is in #${report}. Your issues, reviews, and workflow runs stay here to revisit.`),
  fold('Before you go', `${block('git switch main\ngit pull', 'bash')}

Then delete merged branches with \`git branch -d <name>\`.`),
);

// ---------------------------------------------------------------- shared

export const closedForYou = (issues) => say('voss', 'now', `The description didn't close ${issues.map((n) => `#${n}`).join(' and ')}, so I've closed ${issues.length > 1 ? 'them' : 'it'} by hand. Next time, write \`Closes #N\` in the description and GitHub does it when the pull request merges.`);

export const reopenedTask = (task) => say('voss', 'now', `#${task} isn't finished yet, so I've opened it again. A mission closes when the pull request that completes it merges.`);

export const noTaskNeedsPullRequest = (current) =>
  say('station', 'now', `No task needs a pull request from you right now.${current ? ` Your current task is ${current}.` : ' Check the open issues.'}`);

// One comment per pull request, edited on every run. Problems first; the full
// list of passed checks is folded away.
export const inspectionReport = ({ evaluation, sha, runUrl, passedAll }) => {
  const all = [...evaluation.parts.flatMap((p) => p.findings), ...(evaluation.readiness ?? [])];
  const problems = evaluation.parts.flatMap((p) => p.findings).filter((f) => !f.ok);
  const errors = problems.filter((f) => f.kind === 'content');
  const warnings = problems.filter((f) => f.kind !== 'content');
  const headline = passedAll
    ? `**Passed.** Version \`${sha.slice(0, 7)}\` follows the record rules.`
    : `**Needs a fix** in version \`${sha.slice(0, 7)}\`. [Open the details](${runUrl}).`;
  const parts = evaluation.parts.map((part) => `**${part.title}**\n\n${renderFindings(part.findings)}`).join('\n\n');
  const readiness = evaluation.readiness ? `\n\n**Handover readiness**\n\n${renderFindings(evaluation.readiness)}` : '';
  return sections(
    say('station', 'Record checks', headline),
    errors.length ? alert('CAUTION', `**Must be fixed before this merges**\n\n${renderFindings(errors)}`) : null,
    warnings.length ? alert('WARNING', `**Worth fixing**\n\n${renderFindings(warnings)}`) : null,
    fold(`All ${all.length} checks`, `${parts}${readiness}\n\n<sub>${evaluation.scope} These checks describe the proposed change; it hasn't been merged. Earlier runs stay in the Actions tab.</sub>`),
  );
};

export const stationFault = (runUrl) => sections(
  say('station', 'fault', "Station control couldn't finish checking this version."),
  alert('CAUTION', "This is a fault in the station's own equipment, not in your record."),
  yourMove([`[Open the run](${runUrl}) and choose **Re-run jobs**.`, 'If it fails again, run **Actions → Station control → Run workflow**.']),
);

export const runSummary = ({ title, url, note }) =>
  `## Station control\n\n${note ? `${note}\n\n` : ''}${url ? `Current task: [${title}](${url})` : title}\n`;

export const shiftOpened = (url) => `**Station control:** Shift pack opened: Ring A, December 8. Your first task is [M14.1 · Take the request](${url}).`;
