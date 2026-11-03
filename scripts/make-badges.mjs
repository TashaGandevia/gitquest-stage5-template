#!/usr/bin/env node
// Draws the three Stage 5 mission badges as SVG cards, in GitQuest's badge
// style: dark card, shield icon, title, description, and a Locked/Earned line.
// Locked cards have a dashed grey border; earned ones a solid teal border.
//
//   node scripts/make-badges.mjs     writes .github/badges/*.svg

import { writeFileSync } from 'node:fs';
import { BADGES } from './lib/badges.mjs';

const W = 340;
const H = 112;
const FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A shield outline with the badge's own glyph inside, drawn at (24, 26).
const shield = 'M0 4 L18 0 L36 4 V20 C36 31 28 38 18 42 C8 38 0 31 0 20 Z';

const LOCK = 'M2 6 V4 a4 4 0 0 1 8 0 V6 M0 6 h12 v8 h-12 z';
const TICK = 'M0 5 L4 9 L12 0';

function card(badge, earned) {
  const accent = earned ? '#39E7B1' : '#8B949E';
  const border = earned ? '#39E7B1' : '#30363D';
  const [line1, line2 = ''] = badge.description;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(`${badge.title}: ${earned ? 'earned' : 'locked'}`)}">
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8" fill="#0D1117" stroke="${border}" stroke-width="1.5"${earned ? '' : ' stroke-dasharray="4 3"'}/>
  <g transform="translate(22 30)" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="${shield}"/>
    <g transform="translate(9 9)">${badge.glyph}</g>
  </g>
  <text x="80" y="38" font-family="${FONT}" font-size="15" font-weight="700" fill="#E6EDF3">${escape(badge.title)}</text>
  <text x="80" y="59" font-family="${FONT}" font-size="12" fill="#8B949E">${escape(line1)}</text>
  <text x="80" y="75" font-family="${FONT}" font-size="12" fill="#8B949E">${escape(line2)}</text>
  <g transform="translate(80 86)" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="${earned ? TICK : LOCK}"/>
  </g>
  <text x="98" y="98" font-family="${FONT}" font-size="12" fill="${accent}">${earned ? 'Earned' : 'Locked'}</text>
</svg>
`;
}

for (const badge of BADGES) {
  for (const earned of [true, false]) {
    const path = `.github/badges/${badge.id}-${earned ? 'earned' : 'locked'}.svg`;
    writeFileSync(new URL(`../${path}`, import.meta.url), card(badge, earned));
    console.log(`Wrote ${path}`);
  }
}
