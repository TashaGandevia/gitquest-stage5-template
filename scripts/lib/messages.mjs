// Everything station control says, on issues and pull requests.

import { ARRIVALS_PATH, DEPARTURES_PATH, FAULTS_PATH } from './config.mjs';
import { SHIPS, faultLine, line } from './mission.mjs';

const block = (text) => `\`\`\`text\n${text}\n\`\`\``;

export const task1 = {
  title: "Log Kestrel's departure",
  labels: ['mission'],
  body: `Station control here. **Kestrel** has left the station and the departure log hasn't caught up.

Add this line to \`${DEPARTURES_PATH}\`, under Wren:

${block(line(SHIPS.kestrel))}

How changes reach the station log:

1. Make the change in your own clone, on a new branch (not \`main\`).
2. Commit it, and push the branch to GitHub from your machine.
3. Open a pull request into \`main\`. Its description must say \`Closes #\` followed by this issue's number (next to the title above).
4. Wait for the **Docking inspection** check. Fix anything it flags by pushing more commits to the same branch, then merge.`,
};

export const task2 = {
  title: "Update Osprey's arrival",
  labels: ['mission'],
  body: `**Osprey** has docked. Station control already logged it as inbound, on \`main\` here on GitHub. Your clone doesn't have that change yet.

In \`${ARRIVALS_PATH}\`, change Osprey's line from

${block(line(SHIPS.ospreyInbound))}

to

${block(line(SHIPS.ospreyDocked))}

Bring your local \`main\` up to date before you branch. Then it's the same process as before: branch, commit, push, and a pull request that closes this issue.`,
};

export const task3 = {
  title: "Report Heron's docking clamp fault",
  labels: ['mission'],
  body: `**Heron**'s crew radioed in a docking clamp fault. Faults get their own issue so the station can track them.

Open a **new issue** and choose the **Fault report** template. Station control will reply on your issue with what to do next.`,
};

export const merged1 = (next) =>
  `Kestrel's departure is on record. Station control has updated \`main\` since. Your next task is #${next}.`;

export const merged2 = (next) =>
  `Osprey's arrival is on record. Your next task is #${next}.`;

export const mergedWithoutPassing = (issue) =>
  `This merged before the docking inspection passed, so the task stays open. Fix the problems above in a new pull request for #${issue}.`;

export const noTaskNeedsPullRequest =
  `### Docking inspection\n\nNo station task needs a pull request right now. Check the open issues for your current task.`;

export const faultNeedsTemplate =
  `Station control only tracks faults filed with the **Fault report** template. Add the \`fault\` label to this issue, or open a new one using that template.`;

export const faultLogged = (issue) => `Fault #${issue} is logged, and it's yours to close. No pull request this time: you'll push straight to \`main\`.

1. Add this line to \`${FAULTS_PATH}\`:

${block(faultLine(issue, 'Resolved'))}

2. Commit it on \`main\` with a message that includes \`Fixes #${issue}\`.
3. Push \`main\` to GitHub from your machine.

Station control has kept working on \`main\` while you were reading this. If your push is rejected, read Git's message: bring in the remote changes first, then push again.`;

export const taskFiled = (fault) => `Filed as #${fault}. Follow the instructions there.`;

export const complete = (issue) => `Fault #${issue} is resolved and the station log is in order. **Mission complete.**

Go back to GitQuest and clone this repository in its terminal to run the final check.`;
