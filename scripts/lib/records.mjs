// Parsers for the shift pack's record files. Lenient about spacing, strict about
// values, so the inspection can name the exact file, field and value at fault.

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHIP = /^[A-Z][A-Za-z-]*$/;
const BAY = /^Bay \d+$/;

const normalise = (text) => (text ?? '').replace(/\r\n/g, '\n');

// Lines that hold records: not blank, not headings, quotes or HTML comments.
function recordLines(text) {
  return normalise(text)
    .split('\n')
    .map((raw, index) => ({ line: raw.trim(), number: index + 1 }))
    .filter(({ line }) => line !== '' && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('<!--'));
}

// `2085-12-08 22:40 | Aster | Bay 3`, as in arrivals.md.
export function parseArrivals(text) {
  const entries = [];
  const problems = [];
  for (const { line, number } of recordLines(text)) {
    const parts = line.split('|').map((cell) => cell.trim());
    const [stamp = '', ship, bay] = parts;
    const [date, time, extra] = stamp.split(/\s+/);
    if (parts.length !== 3 || extra !== undefined) {
      problems.push(`line ${number}: expected \`YYYY-MM-DD HH:MM | Ship | Bay N\`, found \`${line}\``);
    } else if (!DATE.test(date ?? '')) {
      problems.push(`line ${number}: date \`${date}\` should look like \`2085-12-08\``);
    } else if (!TIME.test(time ?? '')) {
      problems.push(`line ${number}: time \`${time}\` should be 24-hour \`HH:MM\`, for example \`22:40\``);
    } else if (!SHIP.test(ship)) {
      problems.push(`line ${number}: \`${ship}\` should be a capitalised ship name`);
    } else if (!BAY.test(bay)) {
      problems.push(`line ${number}: \`${bay}\` should be a bay like \`Bay 3\``);
    } else {
      entries.push({ date, time, ship, bay, number });
    }
  }
  return { entries, problems };
}

export const arrivalLine = ({ date, time, ship, bay }) => `${date} ${time} | ${ship} | ${bay}`;

export function hasEntry(entries, expected) {
  return entries.some((entry) => Object.entries(expected).every(([key, value]) => entry[key] === value));
}

// The `## Heading` sections of a Markdown file, keyed by heading text.
// Only the given level counts as a boundary; deeper headings stay in the body.
export function sections(text, level = 2) {
  const marker = `${'#'.repeat(level)} `;
  const result = {};
  let current = null;
  for (const raw of normalise(text).split('\n')) {
    if (raw.startsWith(marker)) {
      current = raw.slice(marker.length).trim();
      result[current] = '';
    } else if (current !== null && /^#{1,6} /.test(raw) && raw.match(/^#+/)[0].length < level) {
      current = null; // a higher-level heading ends the section
    } else if (current !== null) {
      result[current] += `${raw}\n`;
    }
  }
  return result;
}

// `Name: value` lines. Only the named fields are read, so prose with a colon
// elsewhere in the file is ignored. Returns { fields, lines } where `lines`
// remembers the line number of each field for diagnostics.
export function parseFields(text, names) {
  const fields = {};
  const lines = {};
  normalise(text)
    .split('\n')
    .forEach((raw, index) => {
      const match = raw.trim().match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
      if (!match) return;
      const name = names.find((n) => n.toLowerCase() === match[1].trim().toLowerCase());
      if (name && !(name in fields)) {
        fields[name] = match[2].trim();
        lines[name] = index + 1;
      }
    });
  return { fields, lines };
}

// The bay report's evidence lines, read by sentence shape.
export function parseReport(text) {
  const body = normalise(text);
  const release = body.match(/Maintenance released Bay 3 at ([^\s.]+(?:\.\d+)?)\./i);
  const docked = body.match(/Aster docked at ([^\s.]+(?:\.\d+)?)\./i);
  return {
    sections: sections(body),
    release: release ? release[1] : null,
    docked: docked ? docked[1] : null,
  };
}

export function appendLine(text, line) {
  return `${normalise(text).replace(/\n*$/, '\n')}${line}\n`;
}

export function appendBlock(text, block) {
  return `${normalise(text).replace(/\n*$/, '\n')}\n${block.replace(/\n*$/, '\n')}`;
}
