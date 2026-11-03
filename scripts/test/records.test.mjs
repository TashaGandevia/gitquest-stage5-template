import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ARRIVALS_PATH, HANDOVER_PATH, PLAN_PATH } from '../lib/config.mjs';
import { appendBlock, appendLine, hasEntry, parseArrivals, parseFields, parseReport, sections } from '../lib/records.mjs';

const starter = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the starter arrivals parse cleanly and skip the format note', () => {
  const { entries, problems } = parseArrivals(starter(ARRIVALS_PATH));
  assert.deepEqual(problems, []);
  assert.ok(hasEntry(entries, { date: '2085-12-08', time: '06:15', ship: 'Finch', bay: 'Bay 1' }));
});

test('arrival problems name the line and the rule', () => {
  const { problems } = parseArrivals('2085-12-08 22.40 | Aster | Bay 3\nAster | Bay 3\n2085-12-08 22:40 | Aster | 3\n');
  assert.equal(problems.length, 3);
  assert.match(problems[0], /line 1: time `22.40`/);
  assert.match(problems[1], /line 2: expected/);
  assert.match(problems[2], /`3` should be a bay/);
});

test('fields are read by name, case-insensitively, and prose is ignored', () => {
  const { fields, lines } = parseFields(starter(PLAN_PATH), ['Ship', 'Expected', 'Proposed bay', 'Condition']);
  assert.equal(fields.Ship, 'Aster');
  assert.equal(fields.Expected, '20:10');
  assert.equal(fields['Proposed bay'], 'Bay 3');
  assert.match(fields.Condition, /Maintenance/);
  assert.equal(lines.Ship, 6);
  assert.equal(parseFields('expected:22:40', ['Expected']).fields.Expected, '22:40');
});

test('sections split on the given heading level', () => {
  const s = sections(starter(HANDOVER_PATH));
  assert.deepEqual(Object.keys(s), ['Day shift', 'Night shift']);
  assert.match(s['Day shift'], /Corvid/);
  const nested = sections('## Summary\n### Outcome\nA\n### Evidence\nB\n## Other\nC\n', 3);
  assert.deepEqual(nested, { Outcome: 'A\n', Evidence: 'B\n' });
});

test('report times are read from their sentences, including malformed ones', () => {
  assert.deepEqual(
    { ...parseReport('Maintenance released Bay 3 at 22:25.\nAster docked at 22:40.'), sections: undefined },
    { sections: undefined, release: '22:25', docked: '22:40' },
  );
  assert.equal(parseReport('Maintenance released Bay 3 at 22.25.').release, '22.25');
  assert.equal(parseReport('nothing').release, null);
});

test('append helpers keep exactly one trailing newline', () => {
  assert.equal(appendLine('# A\n\nx', 'y'), '# A\n\nx\ny\n');
  assert.equal(appendBlock('# A\n\nx\n\n', '## B\n\ny'), '# A\n\nx\n\n## B\n\ny\n');
});
