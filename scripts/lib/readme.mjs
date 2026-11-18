// The README's two live sections, rewritten by station control every time it
// saves progress: the mission badges at the top (Locked until each mission is
// done, with each finished mission's GitQuest code under them), and "Your
// shift", a table of every task and where the player is.
// Each lives between HTML comment markers, so the rest of the README is
// never touched.

import { BADGES, badgePath } from './badges.mjs';
import { GITQUEST_URL } from './config.mjs';
import { stepTitle } from './missions.mjs';
import { MISSION_STEPS, STEP, allSteps, stepOrder } from './story.mjs';

const MARK = {
  badges: ['<!-- gitquest:badges:start -->', '<!-- gitquest:badges:end -->'],
  progress: ['<!-- gitquest:progress:start -->', '<!-- gitquest:progress:end -->'],
};

const MISSION_NAMES = { m14: 'M14 · On the Other End', m15: 'M15 · A Green Check', m16: 'M16 · Leave It for the Next Shift' };

const issueLink = (n) => `[#${n}](../../issues/${n})`;

// A mission is done once the story has moved past its last task.
export function missionDone(progress, mission) {
  if (progress.complete) return true;
  if (!progress.chunk) return false;
  const order = allSteps(progress);
  const last = stepOrder(progress, mission).at(-1);
  return order.indexOf(progress.chunk) > order.indexOf(last);
}

function badgesBlock(progress) {
  const cards = BADGES.map((badge) => {
    const earned = missionDone(progress, badge.mission);
    return `<img src="${badgePath(badge, earned)}" width="300" alt="${badge.title}: ${earned ? 'earned' : 'locked'}">`;
  });
  const codes = progress.completion?.codes ?? {};
  const written = BADGES.map((badge) => badge.mission.toUpperCase()).filter((mission) => codes[mission]);
  if (!written.length) return `<p>\n${cards.join('\n')}\n</p>`;
  const rows = written.map((mission) => `| ${mission} | \`${codes[mission]}\` |`).join('\n');
  return `<p>\n${cards.join('\n')}\n</p>\n\n**Your GitQuest codes.** Enter each on that mission's page in [GitQuest](${GITQUEST_URL}).\n\n| Mission | Code |\n|---|---|\n${rows}`;
}

function progressBlock(progress, completionIssue) {
  if (progress.step === STEP.NOT_STARTED) {
    return '## Your shift\n\nNot started yet. Open **Actions → Station control → Run workflow** to begin.';
  }
  const order = allSteps(progress);
  const at = progress.complete ? order.length : order.indexOf(progress.chunk);
  const rows = Object.keys(MISSION_STEPS).flatMap((mission) => stepOrder(progress, mission).map((key, i) => {
    const n = progress.steps?.[key];
    const index = order.indexOf(key);
    const status = index < at ? `Done${n ? ` (${issueLink(n)})` : ''}`
      : index === at ? `**Current:** ${n ? issueLink(n) : 'opening…'}`
      : 'Up next';
    return `| ${i === 0 ? `**${MISSION_NAMES[mission]}**` : ''} | ${stepTitle(key, {})} | ${status} |`;
  }));
  const footer = progress.complete
    ? `**Shift complete.** Your GitQuest code for M16 is in ${completionIssue ? issueLink(completionIssue) : 'the Shift report issue'}, and at the top of this README.`
    : 'Updated by Station control each time a task is done.';
  return `## Your shift\n\n| Mission | Task | Status |\n|---|---|---|\n${rows.join('\n')}\n\n${footer}`;
}

function replaceBetween(text, [start, end], block, fallbackAfterTitle) {
  const content = `${start}\n${block}\n${end}`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a >= 0 && b > a) return text.slice(0, a) + content + text.slice(b + end.length);
  if (!fallbackAfterTitle) return `${text.replace(/\n*$/, '\n')}\n${content}\n`;
  // No markers yet: put the block straight under the first heading.
  const lines = text.split('\n');
  const title = lines.findIndex((l) => l.startsWith('# '));
  lines.splice(title + 1, 0, '', content);
  return lines.join('\n');
}

export function renderReadme(text, progress) {
  let out = text ?? '# Docking Log\n';
  out = replaceBetween(out, MARK.progress, progressBlock(progress, progress.completion?.issue), true);
  out = replaceBetween(out, MARK.badges, badgesBlock(progress), true);
  return out;
}
