// Record text that station control writes: Maintenance and Docking notices,
// and the bot-authored arrival proposal the learner reviews in M16.

import { arrivalLine } from './records.mjs';

export const ASTER = {
  date: '2085-12-08',
  ship: 'Aster',
  bay: 'Bay 3',
  oldTime: '20:10',
  time: '22:40', // expected arrival, and the actual docking time
  release: '22:25', // Maintenance released Bay 3
};

export const ASTER_ARRIVAL = arrivalLine({ date: ASTER.date, time: ASTER.time, ship: ASTER.ship, bay: ASTER.bay });

export const HOLD_NOTICE = `## 18:15 · Maintenance duty note

Bay 3 guide-light test is incomplete. Bay remains on hold. Aster's berth is provisional. A further notice will record the release if the test passes.`;

export const RELEASE_NOTICE = `## 22:25 · Maintenance duty note

Bay 3 guide-light test complete. Bay released to Docking at 22:25.`;

export const DOCKING_NOTICES = `# Docking notices · 2085-12-08

Station-authored. Read and cite these; don't edit them.

## 22:40 · Docking arrival confirmation

Aster secured at Bay 3. Relief crew disembarking.
`;

// The bay report as Mika first drafts it: the release time is wrong on purpose.
// Record checks only checks its structure; the learner's review catches it.
export function bayReport({ discrepancy, handoverPr, releaseTime }) {
  return `# Report · Bay 3

## Discrepancy

The night-shift handover told the next shift to prepare Bay 3 without mentioning Maintenance's hold. Recorded in issue #${discrepancy} and corrected in PR #${handoverPr}.

## Evidence

Maintenance released Bay 3 at ${releaseTime}.
Aster docked at ${ASTER.time}.

## Resolution

Bay 3 was held until Maintenance released it. Aster is recorded at Bay 3 in \`docking-log/arrivals.md\`. No further action on this bay.
`;
}

// The handover block Mika hands over in M15. The time separator is wrong.
export const ROUGH_HANDOVER = `Ship: Aster
Expected: 22.40
Bay: 3
Bay status: Hold
Instruction: Prepare Bay 3 for Aster.`;
