// The Stage 5 badges: one per mission. The README shows each as Locked until
// that mission is done, then Earned. The same ids go into
// .gitquest/completion.json, so GitQuest can award matching badges.

export const BADGES = [
  {
    id: 'm14-on-the-other-end',
    mission: 'm14',
    title: 'On the Other End',
    description: ['Push your first branch and merge', 'a pull request (M14).'],
    // An arrow going up: a push.
    glyph: '<path d="M9 16 V3 M3 9 L9 3 L15 9"/><path d="M2 21 H16"/>',
  },
  {
    id: 'm15-read-the-result',
    mission: 'm15',
    title: 'Read the Result',
    description: ['Fix a failed check and record', 'a discrepancy (M15).'],
    // A magnifier with a tick.
    glyph: '<circle cx="8" cy="8" r="7"/><path d="M13 13 L18 18"/><path d="M4.5 8 L7 10.5 L11.5 5.5"/>',
  },
  {
    id: 'm16-second-pair-of-eyes',
    mission: 'm16',
    title: 'Second Pair of Eyes',
    description: ['Review a pull request and hand', 'over the shift (M16).'],
    // An eye.
    glyph: '<path d="M0 9 C4 2 14 2 18 9 C14 16 4 16 0 9 Z"/><circle cx="9" cy="9" r="3"/>',
  },
];

export const badgePath = (badge, earned) => `.github/badges/${badge.id}-${earned ? 'earned' : 'locked'}.svg`;
