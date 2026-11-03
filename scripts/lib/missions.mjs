// The stage's steps. Each step is its own small issue, opened when the step
// before it is done, so there is always exactly one current issue to follow.
//
// Every step uses the same layout (see `layout` below): # Comms with the
// character cards, # Your Tasks with one checkbox per task, its explanation
// and commands in a quote box and any screenshots, then # Notes with hints.
// When station control sees a step is done, the character who'd notice
// confirms it in a comment, links the next issue, and asks the player to
// close this one (or, for the issue a pull request closes, to leave it).

import { DOCKING_NOTICES_PATH, HANDOVER_PATH, MAINTENANCE_NOTICES_PATH, PLAN_PATH, REPORT_PATH } from './config.mjs';
import { ASTER, ROUGH_HANDOVER } from './content.mjs';
import {
  ISSUE_NUMBER,
  SCREENSHOTS,
  alert,
  quote,
  bash,
  block,
  fold,
  laterPush,
  newBranchPush,
  openPullRequest,
  say,
  sections,
  stuck,
} from './messages.mjs';
import { LINK_STEP, STEP } from './story.mjs';

// ---------------------------------------------------------------- layout

// A checklist item per action, with its guidance underneath. A blank line
// ends the list item, so commands render full width and every box stays
// clickable.
const checklist = (items) =>
  `#### Your move\n\n${items.map(([title, body]) => `- [ ] **${title}**${body ? `\n\n${body}` : ''}`).join('\n\n')}`;


// A screenshot: the placeholder line, then the image, loaded from
// .github/screenshots/<name>.png in the player's own copy of the repository
// (SCREENSHOTS is filled in when the issue is created). Every name used is
// recorded, so scripts/list-screenshots.mjs can list them.
export const SCREENSHOT_LIST = new Map();
const shot = (name, description) => {
  SCREENSHOT_LIST.set(name, description);
  return `[SCREENSHOT]: ${description}\n\n![${description.replace(/[[\]]/g, '')}](${SCREENSHOTS}/${name}.png)`;
};



// When `git pull` refuses because local main has a commit GitHub doesn't.
export const divergedHelp = fold('Git says <i>divergent branches</i> or <i>Not possible to fast-forward</i>?', `Your \`main\` has a commit that GitHub's doesn't, usually work committed on \`main\` by mistake. Move it onto a branch, then make \`main\` match GitHub:

${bash(`git switch -c rescued-work
git switch main
git fetch
git reset --hard origin/main`)}

Your commit is safe on \`rescued-work\`. Commit or save anything unfinished **before** the last command: it resets the files on \`main\`. Then carry on from \`git pull\`.`);

const runWorkflowExplainer = fold('How did this issue get here?', `You pressed **Run workflow** in the **Actions** tab. That started **Station control**, a GitHub Action: a small robot that runs when something happens in the repository. This one opened this issue for you, and it will open each next task as you go.

${shot('m14-1-actions-run-workflow', 'The Actions tab, with Station control selected and the Run workflow button highlighted')}`);

// ---------------------------------------------------------------- steps
// `ctx`: { self, link, handoverPr, discrepancy, reviewPr }
//   self: this issue's own number (filled in after it is created)
//   link: the issue this part's pull request closes

// One issue in the house layout, matching M14.1 as edited on GitHub:
//   # Comms       character cards, then an optional quoted intro line
//   # Your Tasks  ## Task n: the checkbox, the explanation in a quote box,
//                 then anything outside it (screenshots, alerts)
//   ---
//   # Notes       hints, "why" folds, examples
// `tasks` items are [title, explanation, ...extra].
const layout = ({ comms = [], intro, tasks = [], notes = [] }) => {
  const extraNotes = notes.filter(Boolean);
  return sections(
    comms.length ? '# Comms' : null,
    ...comms,
    intro ? quote(intro) : null,
    '# Your Tasks',
    ...tasks.map(([title, explanation, ...extra], i) => sections(`## Task ${i + 1}`, `- [ ] **${title}**`, explanation ? quote(explanation) : null, ...extra)),
    extraNotes.length ? '---' : null,
    extraNotes.length ? '# Notes' : null,
    ...extraNotes,
  );
};

// The last task of most issues: close it once the character confirms.
const closeTask = (who) => ['Close this issue', `Once ${who} confirms in a comment below, choose **Close issue** at the bottom of the page.`];

// The last task when this issue is the one the pull request closes.
const leaveOpenTask = (self) => ['Leave this issue open', `Your pull request says \`Closes #${self}\`, so GitHub closes this issue for you when the pull request merges.`];

export const STEPS = {
  // ------------------------------------------------------------ M14
  '14.1': ({ self }) => ({
    title: 'M14.1 · Take the request',
    body: layout({
      comms: [say('mika', '17:50', `Aster's arrival has moved from **${ASTER.oldTime}** to **${ASTER.time}**. Bay 3 is the proposed berth, subject to Maintenance's release.

I need the plan updated with the new time. Can you take it? Put your name on it first, so nobody else starts the same job. Then make the change on your computer and send it to GitHub.`)],
      intro: `This is an **issue**: a request that lives in the repository, with its own number (this one is **#${self}**) and its own conversation.`,
      tasks: [
        ['Assign yourself', 'In the right-hand column, find **Assignees** and choose **assign yourself**. This tells others that you are working on this task. It helps to prevent overlap and wasted work.',
          shot('m14-1-issue-sidebar-assignees-open', 'The issue sidebar, with Assignees open and "assign yourself" highlighted')],
        ['Tick boxes as you go', 'These checkboxes are a **task list**. Click a box to tick it. The issues list shows how many are done, like "2 of 6".',
          shot('m14-1-issue-issues-list-task', 'An issue in the Issues list, showing its task-list progress')],
        ['Make a branch', `In a terminal, inside your cloned folder:

${bash('git switch -c aster-plan')}

Working on a new branch allows others to work in parallel, while keeping \`main\` as a "stable" branch that will always be a working version of the code.`],
        ['Change the time', `This is done within your choice of IDE (Code, Visual Studio, JetBrains, etc).
Open \`${PLAN_PATH}\` in your editor. Change \`Expected: ${ASTER.oldTime}\` to \`Expected: ${ASTER.time}\`. Save. Nothing else changes.`,
          shot('m14-1-plan-file-open-editor', `The plan file open in an editor, with the Expected line changed to ${ASTER.time}`)],
        ['Commit it', `Similar to within the GitQuest application, this runs in the terminal on your system or from within the IDE. Ensure you are in the correct directory before running this.

${bash(`git add ${PLAN_PATH}
git commit -m "Update Aster expected arrival"`)}`],
        ['Send your branch to GitHub', `Within the terminal:

${bash('git push -u origin aster-plan')}

Since GitHub doesn't have the branch \`aster-plan\` yet, the \`-u\` command creates it there **and then links the two**, so Git remembers where this branch goes. That link is called the branch's **upstream**.

${block(`your computer                                         GitHub
  aster-plan              ── git push -u ──►        aster-plan
                         (linked: "upstream")`)}

You need \`-u\` only the **first** time you push a new branch. After that, plain \`git push\` is enough.

${shot('m14-1-terminal-output-git-push', 'Terminal output after git push -u origin aster-plan, showing the new branch created on GitHub')}`,
          alert('IMPORTANT', fold('Typed plain <code>git push</code> by mistake?', `Git stops and shows:

${block(`fatal: The current branch aster-plan has no upstream branch.
To push the current branch and set the remote as upstream, use

    git push --set-upstream origin aster-plan`)}

Nothing is lost! Run the command it suggests (\`--set-upstream\` is the long name for \`-u\`).`))],
        ['Close this issue', `Once Mika confirms they have your branch in a comment below, choose **Close issue** at the bottom of the page.

${shot('m14-1-close-issue-button-under', 'The Close issue button under the comment box')}`],
      ],
      notes: [
        stuck(
          'A plan describes the future. Only the time changed; the status and the condition are still true.',
          `Open \`${PLAN_PATH}\` and find the line starting \`Expected:\`.`,
          'Run each command above in your terminal, inside the cloned folder, in order.',
        ),
        runWorkflowExplainer,
      ],
    }),
  }),

  '14.2': ({ self }) => ({
    title: 'M14.2 · Open a pull request',
    body: layout({
      comms: [say('mika', '18:00', 'Your branch is on GitHub. Send it over as a pull request so I can read it before it goes in the log.')],
      intro: 'A **pull request** asks for a branch to be read, then merged into `main`. It is like handing your draft to a colleague with a note: here\'s what I changed and why, please check it before it goes in the log.',
      tasks: [
        ['Open the pull request', openPullRequest('aster-plan', `\`Closes #${self}\` (this issue's number)`),
          shot('m14-2-yellow-aster-plan-had', 'The yellow "aster-plan had recent pushes" bar with the Compare & pull request button'),
          shot('m14-2-new-pull-request-form', `The new pull request form, showing base: main, compare: aster-plan, and "Closes #${self}" in the description`)],
        ['Understand `Closes`', `\`Closes #${self}\` links your pull request to this issue. When the pull request merges, GitHub closes this issue by itself, like stapling the job ticket to your draft: when the draft is filed, the ticket is marked done with it.`],
        leaveOpenTask(self),
      ],
    }),
  }),

  '14.3': ({ link }) => ({
    title: 'M14.3 · Check and merge',
    body: layout({
      comms: [say('mika', '18:02', 'Got it. The inspector looks at it first, then I\'ll read it.')],
      intro: 'Two things read your pull request: **Record checks** (automatic) and Mika.',
      tasks: [
        ['Watch Record checks', 'At the bottom of your pull request, **Record checks** runs by itself and turns green. **Nothing to do here**: it passes on its own this time. It is an automatic inspector at the door: every time your draft changes, it checks the format before anyone files it. It\'s another GitHub Action, like Station control.',
          shot('m14-3-checks-box-at-bottom', 'The checks box at the bottom of a pull request, with Record checks passed')],
        ['Read Mika\'s reply', 'She replies on the pull request once the checks pass.'],
        ['Merge', 'Choose **Merge pull request → Confirm merge**. This files your draft in the official log: now `main` has your change.',
          shot('m14-3-merge-pull-request-button', 'The Merge pull request button, then Confirm merge')],
        [`See #${link ?? '?'} close`, `Because your description said \`Closes #${link}\`, GitHub has closed M14.2 for you.`],
        ['Delete the branch (optional)', 'GitHub offers **Delete branch** after the merge. It\'s safe: your work is in `main` now. Like shredding the working copy once the final version is in the binder.',
          shot('m14-3-pull-request-successfully-merged', 'The "Pull request successfully merged and closed" box with the Delete branch button')],
        closeTask('Voss'),
      ],
    }),
  }),

  // ------------------------------------------------------------ M15
  '15.1': ({ self }) => ({
    title: 'M15.1 · Send the handover draft',
    body: layout({
      comms: [
        say('maintenance', '18:15', "Bay 3 guide-light test is incomplete. Bay remains on hold. Aster's berth is provisional. A further notice will record the release if the test passes."),
        say('mika', '18:20', `Here's the handover draft. I wrote it between calls. Put it under tonight's heading and send it for inspection.

${block(ROUGH_HANDOVER)}

If the checks find something, open the result. You don't need to start the pull request again.`),
      ],
      intro: 'A handover is the note you leave for the next shift. Like any record, it goes through the same routine: draft it on a branch, have it read, then file it.',
      tasks: [
        ['Assign yourself', 'Same as M14: **Assignees → assign yourself**.'],
        ['Start from the latest main', `${bash(`git switch main
git pull
git switch -c night-handover`)}

\`git pull\` brings your M14 merge and Maintenance's new notice down from GitHub, so you're not working from yesterday's copy. The new branch starts from there.`,
          divergedHelp],
        ['Paste the draft', `Open \`${HANDOVER_PATH}\`. Under \`## Night shift\`, replace the \`<!-- ... -->\` line with Mika's five lines. Save.`],
        ['Commit it', bash(`git add ${HANDOVER_PATH}
git commit -m "Add night-shift handover"`)],
        ['Send your branch to GitHub', newBranchPush('night-handover')],
        ['Open a pull request', openPullRequest('night-handover', `\`Closes #${self}\``)],
        ['Wait for Record checks. Don\'t merge', 'Record checks takes about a minute. This time it will probably find a problem in Mika\'s draft. That\'s expected: fixing it is the next task. **Don\'t merge** until Record checks is green and Mika has read it.',
          alert('WARNING', 'GitHub lets you merge while a check is still running, or even red. A green tick next to **Station control** only means the story was updated. The one that matters is **Record checks**.')],
        leaveOpenTask(self),
      ],
      notes: [stuck(
        'Paste Mika\'s draft as it is. The checks will help.',
        `The \`## Day shift\` block in \`${HANDOVER_PATH}\` shows the format.`,
        'Run each command above in order; edit the file between "Start" and "Commit".',
      )],
    }),
  }),

  '15.2': ({ handoverPr }) => ({
    title: 'M15.2 · Fix the failed check',
    body: layout({
      comms: [say('voss', '18:40', 'The check found a problem in the draft. Open its details and read the failed step. The file and the value are both there.')],
      intro: `**Record checks** found a problem in pull request #${handoverPr}. Its result says exactly what. The inspector has handed your draft back with a note: you fix the draft and hand it back, you don't start a new one.`,
      tasks: [
        ['Open the result', `On #${handoverPr}, scroll to **Record checks** and choose **Details**. Open the step marked as failed (red). It names the file, the value it found, and the right form.`,
          shot('m15-2-failed-record-checks-run', 'A failed Record checks run, with the "Validate handover" step expanded and the FAIL handover-time message visible')],
        ['Fix the file', `Make the fix in \`${HANDOVER_PATH}\` and save.`],
        ['Send the fix', laterPush(HANDOVER_PATH, 'Fix handover time'),
          shot('m15-2-pull-request-push-new', 'The pull request after the push, showing the new commit and Record checks running again')],
        ['Watch it run again', 'The pull request updates by itself, and **Record checks** runs again on the new commit.'],
        closeTask('Voss'),
      ],
      notes: [stuck(
        'Times in the log are always written one way.',
        'The red step\'s message shows the value it found and an example.',
        'Change `Expected: 22.40` to `Expected: 22:40`, then send the fix.',
      )],
    }),
  }),

  '15.3': ({ handoverPr }) => ({
    title: 'M15.3 · Report the discrepancy',
    body: layout({
      comms: [say('mika', '19:05', `The format's right now. Read the instruction beside Maintenance's notice, though. "Prepare Bay 3" could send the next shift down there before the hold is lifted. That's my wording. Can you record it as a discrepancy, so the correction has a trail?`)],
      intro: 'A discrepancy report is like an incident form: where the problem is, what it says, what it should say, and the evidence. Anyone can follow it later without asking you.',
      tasks: [
        ['Open the form', 'Go to **Issues → New issue** and choose **Record discrepancy**.',
          shot('m15-3-new-issue-page-record', 'The New issue page with the Record discrepancy template')],
        ['Fill in each box', `- **File:** \`${HANDOVER_PATH}\`
- **Location:** \`Instruction field, PR #${handoverPr}\`
- **Observed:** \`Prepare Bay 3 for Aster.\`
- **Expected:** in your own words, what it should make clear
- **Evidence:** the 18:15 Maintenance duty note`,
          shot('m15-3-record-discrepancy-form-filled', 'The Record discrepancy form filled in')],
        ['Submit it', 'Choose **Submit new issue**. The label is added for you. If anything is missing, station control replies and you can edit the issue.'],
        ['Close this issue', 'Once Voss confirms in a comment below, choose **Close issue** at the bottom of the page. Leave the discrepancy issue itself open: it closes when the fix merges.'],
      ],
      notes: [fold('Record checks is green, so why?', '**Record checks** only knows the rules it was given: the format is right. A person read what the sentence *means*. That\'s why the second result, **Handover readiness**, waits for this.')],
    }),
  }),

  '15.4': ({ link, handoverPr, discrepancy }) => ({
    title: 'M15.4 · Answer the review and merge',
    body: layout({
      comms: [say('voss', '19:30', "That's enough for someone else to follow: where it is, what it says, and why it needs changing. Put the correction on the branch you already have.")],
      intro: `Fix the draft on the same branch, attach discrepancy #${discrepancy} to pull request #${handoverPr}, and tell Mika what you did.`,
      tasks: [
        ['Rewrite the instruction', `In \`${HANDOVER_PATH}\`, make it say to wait, for example:

${block('Instruction: Wait for Maintenance to release Bay 3 before preparing it for Aster.')}`],
        ['Send the fix', laterPush(HANDOVER_PATH, 'Make the Bay 3 hold explicit')],
        ['Link the discrepancy', `On #${handoverPr}, choose **⋯ → Edit** on the description. Under the \`Closes #${link}\` line, add \`Fixes #${discrepancy}\`. Save.`,
          shot('m15-4-editing-pull-request-description', 'Editing a pull request description, with "Closes" and "Fixes" lines')],
        ['Tell Mika', `Reply on #${handoverPr} with what you changed.`],
        ['Merge', 'When **Record checks** and **Handover readiness** are both green, merge it.',
          shot('m15-4-checks-box-both-record', 'The checks box with both Record checks and Handover readiness passed')],
        closeTask('Voss'),
      ],
      notes: [fold('Why the description, not a reply?', 'Only the **description** can close issues on merge. Writing an issue number in a reply links it, but closes nothing.')],
    }),
  }),

  // ------------------------------------------------------------ M16
  '16.1': ({ reviewPr }) => ({
    title: 'M16.1 · Review Mika\'s pull request',
    body: layout({
      comms: [
        say('maintenance', '22:25', 'Bay 3 guide-light test complete. Bay released to Docking at 22:25.'),
        say('docking', '22:40', 'Aster secured at Bay 3. Relief crew disembarking.'),
        say('mika', '22:45', `Aster's in. I've put the arrival and the bay report in pull request #${reviewPr}. Your turn to read it. Compare the two times with the notices above before you approve.`),
      ],
      intro: 'Now you\'re the colleague checking someone else\'s draft. You don\'t fix it yourself; you say what\'s wrong, and they fix it.',
      tasks: [
        ['Assign yourself', 'Same as before: **Assignees → assign yourself**.'],
        ['Open the changes', `Open #${reviewPr} and choose **Files changed**.`,
          shot('m16-1-files-changed-tab', 'Mika\'s pull request with the Files changed tab selected')],
        ['Compare the times', `Read the report's **Evidence** lines. Which notice does each one come from? Do the times match?

The notices are above, and in \`${MAINTENANCE_NOTICES_PATH}\` and \`${DOCKING_NOTICES_PATH}\`.`],
        ['Comment on the wrong line', 'Hover over the line, press the blue **+**, write what\'s wrong and which time is right, and choose **Start a review**.',
          shot('m16-1-line-comment-being-written', 'A line comment being written on the report\'s release line')],
        ['Request changes', 'Choose **Finish your review**, pick **Request changes**, and submit.',
          shot('m16-1-finish-your-review-panel', 'The Finish your review panel with Request changes selected')],
        closeTask('Mika'),
      ],
      notes: [
        fold('The three review choices', `- **Comment**: feedback, no decision.
- **Approve**: this version is right.
- **Request changes**: something must change before it merges.

GitHub won't let you approve your own pull request. That's one reason a second reader matters. This one is Mika's, so you can.`),
        stuck(
          'Two events happened close together. Each sentence should match the notice for its own event.',
          `The **Evidence** section of \`${REPORT_PATH}\`, beside the 22:25 Maintenance notice.`,
          'Comment on "Maintenance released Bay 3 at 22:40." that the notice says 22:25, then submit with **Request changes**.',
        ),
      ],
    }),
  }),

  '16.2': ({ reviewPr }) => ({
    title: 'M16.2 · Approve and merge',
    body: layout({
      comms: [say('mika', '22:55', `You're right. I copied the arrival time into both lines. The fix is on #${reviewPr}.`)],
      intro: 'Signing off a corrected draft, then filing it, are two separate acts: one says "this is right", the other puts it in the log.',
      tasks: [
        ['Read the new version', `On #${reviewPr}, open **Files changed** again. The release time should now match the notice.`],
        ['Wait for Record checks', 'The fresh result appears at the bottom of the pull request.'],
        ['Approve', 'Choose **Review changes → Approve** and submit. That records your decision on this version.',
          shot('m16-2-review-panel-approve-selected', 'The review panel with Approve selected')],
        ['Merge', 'Merging is a separate step: choose **Merge pull request → Confirm merge**.'],
        closeTask('Voss'),
      ],
    }),
  }),

  '16.R': ({ self, reviewPr }) => ({
    title: 'M16.2 · Repair the release time',
    body: layout({
      comms: [say('mika', '23:05', `Pull request #${reviewPr} went in before the release time was fixed. The report says 22:40; the notice says ${ASTER.release}. Nothing's lost: the history shows what happened. Can you send the correction through?`)],
      intro: 'A wrong entry got filed. You don\'t tear the page out: you file a correction, so anyone can see what changed and why.',
      tasks: [
        ['Start from the latest main', bash(`git switch main
git pull
git switch -c fix-release-time`), divergedHelp],
        ['Fix the time', `In \`${REPORT_PATH}\`, make it say \`Maintenance released Bay 3 at ${ASTER.release}.\` Leave \`Aster docked at ${ASTER.time}.\` Save.`],
        ['Commit it', bash(`git add ${REPORT_PATH}
git commit -m "Correct Bay 3 release time"`)],
        ['Send your branch to GitHub', newBranchPush('fix-release-time')],
        ['Open a pull request', openPullRequest('fix-release-time', `\`Closes #${self}\``)],
        ['Merge', 'When **Record checks** is green, merge it.'],
        leaveOpenTask(self),
      ],
    }),
  }),

  '16.3': ({ self, discrepancy, reviewPr }) => ({
    title: 'M16.3 · Write the final handover',
    body: layout({
      comms: [say('voss', '23:10', 'Finish the handover. What was planned, what held it up, what changed, and where the next person can check it.')],
      intro: 'The note the next shift reads first. Someone who wasn\'t here tonight should understand what happened, and know where to check it, without phoning you.',
      tasks: [
        ['Start from the latest main', `${bash(`git switch main
git pull
git switch -c final-handover`)}

This brings the merged arrival and report to your computer first.`, divergedHelp],
        ['Write the summary', `At the end of \`${HANDOVER_PATH}\`, add this and fill in each part in your own words:

${block(`## Summary

### Outcome
(what happened, with both times)

### Evidence
(link #${discrepancy} and #${reviewPr})

### Outstanding work
(what's left for the next shift, even if it's "None")`, 'markdown')}`],
        ['Commit it', bash(`git add ${HANDOVER_PATH}
git commit -m "Finish the December 8 handover"`)],
        ['Send your branch to GitHub', newBranchPush('final-handover')],
        ['Open a pull request', openPullRequest('final-handover', `\`Closes #${self}\``)],
        leaveOpenTask(self),
      ],
      notes: [fold('See a finished example', block(`## Summary

### Outcome

Aster was expected at 22:40. Bay 3 remained on hold while Maintenance completed the guide-light test. Maintenance released the bay at 22:25 and Aster docked at 22:40.

### Evidence

We corrected the handover to make the hold explicit; see issue #${discrepancy}. The arrival and corrected report are recorded in PR #${reviewPr}.

### Outstanding work

No action remains for the next shift on this arrival.`, 'markdown'))],
    }),
  }),

  '16.4': ({ link }) => ({
    title: 'M16.4 · Hand it over',
    body: layout({
      comms: [say('voss', '23:25', 'Last task of the night.')],
      tasks: [
        ['Wait for Record checks to pass', 'It checks the two times and the two links. It can\'t judge your writing, and it won\'t pretend to. If it\'s red, its comment says what to fix.'],
        ['Read Voss\'s reply', 'He replies on the pull request once the checks pass.'],
        ['Merge', `Choose **Merge pull request → Confirm merge**. #${link} closes by itself.`],
        closeTask('Mika'),
      ],
    }),
  }),
};

export const stepTitle = (key, ctx = {}) => STEPS[key](ctx).title;

// The issue for a step. The body keeps the ISSUE_NUMBER token for `self`;
// station control fills in the real number right after creating it.
export const stepIssue = (key, ctx) => {
  const step = STEPS[key]({ ...ctx, self: ISSUE_NUMBER });
  return { title: step.title, labels: ['task'], body: step.body };
};

// ---------------------------------------------------------------- confirmations
// `c`: { pr, discrepancy, reviewPr, repair }

const CONFIRM = {
  '14.1': ['mika', '18:00', (c) => (c.assigned
    ? 'I can see `aster-plan` on GitHub from here, with your name on the job.'
    : 'I can see `aster-plan` on GitHub from here. One thing: your name isn\'t on the job yet. Choose **Assignees → assign yourself** on this issue, so nobody else starts it.')],
  '14.2': ['mika', '18:01', (c) => `Pull request #${c.pr} is in.`],
  '14.3': ['voss', '18:10', () => 'Merged, and the plan is on `main`. That finishes M14.'],
  '15.1': ['mika', '18:35', (c) => `Got your handover in pull request #${c.pr}.`],
  '15.2': ['voss', '18:50', (c) => `**Record checks** is green on #${c.pr}.`],
  '15.3': ['voss', '19:30', (c) => `Discrepancy #${c.discrepancy} is on record.`],
  '15.4': ['voss', '22:20', () => 'Merged. The handover says what the next shift needs. That finishes M15.'],
  '16.1': ['mika', '22:55', (c) => (c.repair ? 'My pull request is merged, so the review is over.' : 'Thanks for checking the notice. My correction is pushed.')],
  '16.2': ['voss', '23:09', () => 'The arrival and the report are on `main`.'],
  '16.R': ['voss', '23:09', () => 'Your repair is merged. The report agrees with Maintenance now.'],
  '16.3': ['voss', '23:25', (c) => `Got your summary in pull request #${c.pr}.`],
  '16.4': ['mika', '23:50', () => "The handover's merged. That finishes M16."],
};

const PR_CLOSES = new Set(Object.values(LINK_STEP));

// One comment confirming `key`, on that step's own issue. `next` is the next
// step's issue: { number, title }, or null at the end of the stage.
export function confirmation(key, { c, next, login, self }) {
  const [who, time, line] = CONFIRM[key];
  const close = PR_CLOSES.has(key)
    ? `Tick off the boxes. Leave this issue open: it closes by itself when your pull request merges.`
    : 'Tick off any boxes you haven\'t, then close this issue.';
  const nextLine = next ? `\n\nYour next task: #${next.number} · **${next.title}**.` : '';
  return sections(say(who, time, `${line(c)} ${close}${nextLine}`), login ? `<sub>@${login}</sub>` : null);
}

// ---------------------------------------------------------------- recovery

const REDO = {
  [STEP.PLAN]: { branch: 'aster-plan-2', file: PLAN_PATH, change: `Change \`Expected:\` to \`${ASTER.time}\` again.`, message: 'Update Aster expected arrival' },
  [STEP.HANDOVER]: { branch: 'night-handover-2', file: HANDOVER_PATH, change: 'Put the night-shift block back under `## Night shift`, with the fixes you\'d made.', message: 'Add night-shift handover' },
  [STEP.REPAIR]: { branch: 'fix-release-time-2', file: REPORT_PATH, change: `Make the release line say \`${ASTER.release}\` again.`, message: 'Correct Bay 3 release time' },
  [STEP.FINAL]: { branch: 'final-handover-2', file: HANDOVER_PATH, change: 'Add your `## Summary` again.', message: 'Finish the December 8 handover' },
};

// "Do this instead": pull, new branch, change, push -u, pull request.
function redoChecklist(step, closes, change) {
  const redo = REDO[step];
  return checklist([
    ['Bring your computer up to date', `${bash(`git switch main
git pull`)}

${divergedHelp}`],
    ['Start a new branch', `${bash(`git switch -c ${redo.branch}`)}

A new name, because your earlier branch is already in \`main\`'s history, so GitHub would see nothing new in it.`],
    ['Make the change again', `In \`${redo.file}\`: ${change ?? redo.change} Save.`],
    ['Commit it', bash(`git add ${redo.file}
git commit -m "${redo.message}"`)],
    ['Send your branch to GitHub', newBranchPush(redo.branch)],
    ['Open a pull request', openPullRequest(redo.branch, `\`Closes #${closes}\``)],
  ]).replace('#### Your move', '#### Do this instead');
}

const mention = (login) => (login ? `<sub>@${login}</sub>` : null);

// A direct push to main changed records; station control has undone it.
export function directPushUndone({ step, closes, files, login }) {
  const list = files.map((f) => `\`${f}\``).join(', ');
  const story = say('voss', 'now', `That went straight onto \`main\`. Nobody read it first, so I've put ${list} back the way ${files.length > 1 ? 'they were' : 'it was'}.

Your commit is still in the history. Nothing's lost. On this station, changes to the record reach \`main\` through a pull request, so someone can read them.`);
  const warning = alert('WARNING', `**Your push to \`main\` was undone.** ${list} ${files.length > 1 ? 'are' : 'is'} back as ${files.length > 1 ? 'they were' : 'it was'} before it. Changes reach \`main\` through a pull request.`);
  if (!REDO[step] || !closes) {
    return sections(story, warning, say('voss', 'now', 'Nothing to redo for now. Carry on with your current task.'), mention(login));
  }
  return sections(story, warning, redoChecklist(step, closes), mention(login));
}

// A pull request merged before its record was right.
export function mergedTooEarly({ step, closes, problems, login }) {
  return sections(
    say('voss', 'now', `That merged before the record was right, so #${closes} stays open. The history keeps what happened; we fix it with a new pull request.`),
    alert('CAUTION', `**What needs fixing**\n\n${problems}`),
    REDO[step] ? redoChecklist(step, closes, 'Fix what\'s listed above.') : null,
    mention(login),
  );
}

// A GitHub "Revert" pull request: allowed, but on this station we fix forward.
export function revertAdvice({ step, closes, reverted, login }) {
  return sections(
    say('voss', 'now', `This would undo #${reverted}. You can merge it, but you don't need to. On this station we **fix forward**: the mistake stays in the history, and a new pull request puts it right.`),
    alert('WARNING', `**Recommended:** close this pull request without merging, then follow the checklist below. If you merge it anyway, that's fine: the checklist still works.`),
    REDO[step] && closes ? redoChecklist(step, closes, 'Put it right, with the fix this time.') : null,
    mention(login),
  );
}

export const revertMerged = ({ reverted, login }) => sections(
  say('voss', 'now', `#${reverted} is undone on \`main\`. The history still shows both. Carry on with the checklist above to put it right.`),
  mention(login),
);

// The wrap-up issue: the player's one-time GitQuest code. Not a task: the
// stage is already complete when it opens, and closing it is optional.
export const shiftReport = ({ code, redeemUrl }) => ({
  title: 'Shift report · Your GitQuest code',
  labels: ['station'],
  body: sections(
    '# Comms',
    say('voss', '23:58', 'Shift complete. Take this code back to GitQuest, and the record there will show what you did tonight.'),
    quote('Your three badges are at the top of this repository\'s README. This code puts the same badges on your GitQuest profile.'),
    '# Your Code',
    block(code),
    `**[Redeem it in GitQuest](${redeemUrl})**, or paste the code into GitQuest yourself.`,
    alert('IMPORTANT', 'The code works **once**. Keep it to yourself until you\'ve used it.'),
    '---',
    '# Notes',
    'Nothing else to do in this repository: the stage is already complete. You can close this issue whenever you like.',
    fold('Where is the code kept?', 'In `.gitquest/completion.json` on `main`, with the repository, the badges and the commits it vouches for. GitQuest reads that file to check the code is yours.'),
  ),
});
