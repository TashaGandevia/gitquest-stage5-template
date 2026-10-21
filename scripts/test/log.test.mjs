import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendLine, hasEntry, parseFaultLog, parseShipLog } from '../lib/log.mjs';

test('parses ship lines and ignores headings and blank lines', () => {
  const { entries, problems } = parseShipLog('# Departure Records\n\nWren | Departed | 08:40\r\nKestrel|Departed|09:15\n');
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 2);
  assert.ok(hasEntry(entries, { name: 'Kestrel', status: 'Departed', time: '09:15' }));
});

test('reports each kind of ship line problem', () => {
  const { problems } = parseShipLog('Wren | Departed\nkestrel | Departed | 09:15\nOsprey | Landed | 10:00\nHeron | Docked | 9:15\n');
  assert.equal(problems.length, 4);
  assert.match(problems[0], /line 1: expected/);
  assert.match(problems[1], /capitalised/);
  assert.match(problems[2], /status `Landed`/);
  assert.match(problems[3], /HH:MM/);
});

test('parses fault lines', () => {
  const { entries, problems } = parseFaultLog('# Fault Records\n\n#12 | Heron | Docking clamp | Resolved\n');
  assert.deepEqual(problems, []);
  assert.ok(hasEntry(entries, { issue: 12, ship: 'Heron', fault: 'Docking clamp', status: 'Resolved' }));
  assert.equal(parseFaultLog('12 | Heron | Docking clamp | Fixed').problems.length, 1);
});

test('appends a line after exactly one newline', () => {
  assert.equal(appendLine('# A\n\nWren | Departed | 08:40', 'X'), '# A\n\nWren | Departed | 08:40\nX\n');
  assert.equal(appendLine('# A\n\n', 'X'), '# A\nX\n');
});
