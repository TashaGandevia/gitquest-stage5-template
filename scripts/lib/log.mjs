// Parsing for the docking log files. Lenient about spacing around `|`, strict
// about names, statuses and times, so the inspection can say exactly what's wrong.

const NAME = /^[A-Z][A-Za-z-]*$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SHIP_STATUSES = ['Departed', 'Inbound', 'Docked'];
const FAULT_STATUSES = ['Open', 'Resolved'];

function recordLines(text) {
  return (text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw, index) => ({ line: raw.trim(), number: index + 1 }))
    .filter(({ line }) => line !== '' && !line.startsWith('# '));
}

function cells(line) {
  return line.split('|').map((cell) => cell.trim());
}

// `Name | Status | HH:MM`, as in departures.md and arrivals.md.
export function parseShipLog(text) {
  const entries = [];
  const problems = [];
  for (const { line, number } of recordLines(text)) {
    const parts = cells(line);
    const [name, status, time] = parts;
    if (parts.length !== 3) {
      problems.push(`line ${number}: expected \`Name | Status | HH:MM\`, found \`${line}\``);
    } else if (!NAME.test(name)) {
      problems.push(`line ${number}: \`${name}\` should be a capitalised ship name`);
    } else if (!SHIP_STATUSES.includes(status)) {
      problems.push(`line ${number}: status \`${status}\` should be one of ${SHIP_STATUSES.join(', ')}`);
    } else if (!TIME.test(time)) {
      problems.push(`line ${number}: time \`${time}\` should be 24-hour \`HH:MM\``);
    } else {
      entries.push({ name, status, time, number });
    }
  }
  return { entries, problems };
}

// `#N | Ship | Fault | Status`, as in faults.md.
export function parseFaultLog(text) {
  const entries = [];
  const problems = [];
  for (const { line, number } of recordLines(text)) {
    const parts = cells(line);
    const [issue, ship, fault, status] = parts;
    if (parts.length !== 4) {
      problems.push(`line ${number}: expected \`#N | Ship | Fault | Status\`, found \`${line}\``);
    } else if (!/^#\d+$/.test(issue)) {
      problems.push(`line ${number}: \`${issue}\` should be an issue number like \`#7\``);
    } else if (!NAME.test(ship)) {
      problems.push(`line ${number}: \`${ship}\` should be a capitalised ship name`);
    } else if (!FAULT_STATUSES.includes(status)) {
      problems.push(`line ${number}: status \`${status}\` should be one of ${FAULT_STATUSES.join(', ')}`);
    } else {
      entries.push({ issue: Number(issue.slice(1)), ship, fault, status, number });
    }
  }
  return { entries, problems };
}

export function hasEntry(entries, expected) {
  return entries.some((entry) => Object.entries(expected).every(([key, value]) => entry[key] === value));
}

export function appendLine(text, line) {
  return `${(text ?? '').replace(/\n*$/, '\n')}${line}\n`;
}
