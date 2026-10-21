// Runs station.mjs as the workflows do, against real Git repositories and a
// fake GitHub API, to cover the Git plumbing the unit tests can't.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const STATION = fileURLToPath(new URL('../station.mjs', import.meta.url));
const REPO = 'learner/docking-log';
const LEARNER = { GIT_COMMITTER_NAME: 'Learner', GIT_COMMITTER_EMAIL: 'learner@example.com' };
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Learner',
  GIT_AUTHOR_EMAIL: 'learner@example.com',
  GIT_COMMITTER_NAME: 'Station',
  GIT_COMMITTER_EMAIL: 'station@example.com',
};

let root;
let api;

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...GIT_ENV, ...env }, encoding: 'utf8' }).trim();

function commitFile(cwd, path, content, message, env) {
  writeFileSync(join(cwd, path), content);
  git(cwd, ['add', path]);
  git(cwd, ['commit', '-q', '-m', message], env);
  return git(cwd, ['rev-parse', 'HEAD']);
}

// A fake GitHub API: answers from `state`, records every call.
function startApi() {
  const calls = [];
  const state = { progress: null, files: {} };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: url.pathname, body });
      const send = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value ?? {}));
      };
      const contents = url.pathname.match(/\/contents\/(.+)$/);
      if (req.method === 'GET' && url.pathname === `/repos/${REPO}`) return send(200, { is_template: false, default_branch: 'main' });
      if (req.method === 'GET' && contents) {
        const path = decodeURIComponent(contents[1]);
        const text = path === '.gitquest/progress.json' ? JSON.stringify(state.progress) : state.files[path];
        return text == null ? send(404) : send(200, { content: Buffer.from(text).toString('base64') });
      }
      if (req.method === 'GET' && url.pathname.endsWith('/comments')) return send(200, []);
      if (req.method === 'POST' && url.pathname.endsWith('/issues')) return send(201, { number: 42 });
      if (req.method === 'GET' && url.pathname.includes('/git/ref/')) return send(200, { object: { sha: 'parent' } });
      if (req.method === 'GET' && url.pathname.includes('/git/commits/')) return send(200, { tree: { sha: 'tree' } });
      if (req.method === 'POST' && url.pathname.endsWith('/git/trees')) return send(201, { sha: 'newtree' });
      if (req.method === 'POST' && url.pathname.endsWith('/git/commits')) return send(201, { sha: 'newcommit' });
      return send(200, {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, state, url: `http://127.0.0.1:${server.address().port}` })));
}

function runStation(cwd, eventName, event) {
  const eventPath = join(root, `event-${Date.now()}-${Math.random()}.json`);
  writeFileSync(eventPath, JSON.stringify(event));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [STATION], {
      cwd,
      env: {
        ...GIT_ENV,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_REPOSITORY: REPO,
        GITHUB_TOKEN: 'test-token',
        GITHUB_API_URL: api.url,
      },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code, output }));
  });
}

// origin.git with T0 and T1 on main; `learner` is a clone made before T1.
let origin, seed, learner, station, t0, t1;

before(async () => {
  api = await startApi();
  root = mkdtempSync(join(tmpdir(), 'station-test-'));
  origin = join(root, 'origin.git');
  seed = join(root, 'seed');
  learner = join(root, 'learner');
  station = join(root, 'station');

  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, ['clone', '-q', origin, seed]);
  git(seed, ['checkout', '-q', '-b', 'main']);
  execFileSync('mkdir', ['-p', join(seed, 'docking-log')]);
  commitFile(seed, 'docking-log/departures.md', '# Departure Records\n\nWren | Departed | 08:40\n', 'Template');
  commitFile(seed, 'docking-log/arrivals.md', '# Arrival Records\n\nFinch | Docked | 07:55\n', 'Template arrivals');
  t0 = commitFile(seed, 'docking-log/faults.md', '# Fault Records\n\n', '[station] T0: mission started');
  git(seed, ['push', '-q', 'origin', 'main']);
  git(root, ['clone', '-q', origin, learner]);
  t1 = commitFile(seed, 'docking-log/arrivals.md', '# Arrival Records\n\nFinch | Docked | 07:55\nOsprey | Inbound | 10:30\n', '[station] T1: Osprey inbound');
  git(seed, ['push', '-q', 'origin', 'main']);
});

after(() => {
  api?.server.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

function pushPullRequest(number, base, edit) {
  git(learner, ['checkout', '-q', '-B', `pr-${number}`, base]);
  const head = edit();
  git(learner, ['push', '-q', 'origin', `HEAD:refs/pull/${number}/head`]);
  return head;
}

function freshStationCheckout() {
  rmSync(station, { recursive: true, force: true });
  git(root, ['clone', '-q', origin, station]);
}

const lastCommentOn = (number) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === `/repos/${REPO}/issues/${number}/comments`).at(-1)?.body.body;

test('step 2 inspection fails a branch made before station control\'s transmission', async () => {
  api.state.progress = { schema: 1, step: 2, issues: { task1: 1, task2: 3 } };
  git(learner, ['fetch', '-q', 'origin']);
  const head = pushPullRequest(7, t0, () =>
    commitFile(learner, 'docking-log/arrivals.md', '# Arrival Records\n\nFinch | Docked | 07:55\nOsprey | Docked | 10:42\n', 'Osprey docked', LEARNER));
  freshStationCheckout();

  const { code, output } = await runStation(station, 'pull_request', {
    action: 'opened',
    sender: { type: 'User' },
    pull_request: { number: 7, body: 'Closes #3', head: { sha: head }, base: { sha: t1 } },
  });
  assert.equal(code, 1, output);
  assert.match(lastCommentOn(7), /missing station control's latest change/);
  assert.match(lastCommentOn(7), /<!-- gitquest:inspection -->/);
});

test('step 2 inspection passes once the branch includes the transmission', async () => {
  const head = pushPullRequest(8, t1, () =>
    commitFile(learner, 'docking-log/arrivals.md', '# Arrival Records\n\nFinch | Docked | 07:55\nOsprey | Docked | 10:42\n', 'Osprey docked', LEARNER));
  freshStationCheckout();

  const { code, output } = await runStation(station, 'pull_request', {
    action: 'synchronize',
    sender: { type: 'User' },
    pull_request: { number: 8, body: 'Fixes #3', head: { sha: head }, base: { sha: t1 } },
  });
  assert.equal(code, 0, output);
  assert.match(lastCommentOn(8), /Docking inspection: passed/);
});

test('a merged step 1 pull request opens task 2 and commits transmission 1', async () => {
  api.state.progress = { schema: 1, step: 1, issues: { task1: 1 } };
  api.state.files['docking-log/arrivals.md'] = '# Arrival Records\n\nFinch | Docked | 07:55\n';
  const head = pushPullRequest(2, t0, () =>
    commitFile(learner, 'docking-log/departures.md', '# Departure Records\n\nWren | Departed | 08:40\nKestrel | Departed | 09:15\n', 'Log Kestrel', LEARNER));
  freshStationCheckout();
  api.calls.length = 0;

  const { code, output } = await runStation(station, 'pull_request', {
    action: 'closed',
    sender: { type: 'User' },
    pull_request: { number: 2, merged: true, body: 'Closes #1', head: { sha: head }, base: { sha: t0 } },
  });
  assert.equal(code, 0, output);

  const tree = api.calls.find((c) => c.path.endsWith('/git/trees')).body.tree;
  const file = (path) => tree.find((entry) => entry.path === path).content;
  assert.match(file('docking-log/arrivals.md'), /Osprey \| Inbound \| 10:30\n$/);
  assert.deepEqual(JSON.parse(file('.gitquest/progress.json')).issues, { task1: 1, task2: 42 });
  assert.match(api.calls.find((c) => c.path.endsWith('/git/commits') && c.method === 'POST').body.message, /^\[station\] T1: /);
  assert.match(lastCommentOn(2), /next task is #42/);
});

test('a step 4 push from the web editor is not accepted', async () => {
  api.state.progress = { schema: 1, step: 4, issues: { task1: 1, task2: 3, task3: 5, fault: 9 } };
  git(learner, ['checkout', '-q', '-B', 'main', t1]);
  const head = commitFile(learner, 'docking-log/faults.md', '# Fault Records\n\n#9 | Heron | Docking clamp | Resolved\n', 'Fixes #9', LEARNER);
  git(learner, ['push', '-q', 'origin', 'main']);
  freshStationCheckout();
  api.calls.length = 0;

  const event = {
    ref: 'refs/heads/main',
    after: head,
    sender: { type: 'User' },
    commits: [{ message: 'Fixes #9' }],
    head_commit: { committer: { email: 'noreply@github.com' } },
  };
  await runStation(station, 'push', event);
  assert.ok(!api.calls.some((c) => c.path.endsWith('/git/trees')), 'no transmission');
  assert.match(lastCommentOn(9), /came from GitHub's website/);

  event.head_commit.committer.email = 'learner@example.com';
  api.calls.length = 0;
  await runStation(station, 'push', event);
  const progress = JSON.parse(api.calls.find((c) => c.path.endsWith('/git/trees')).body.tree[0].content);
  assert.equal(progress.step, 5);
  assert.match(lastCommentOn(9), /Mission complete/);
});

test('the template repository itself stays offline', async () => {
  api.calls.length = 0;
  const eventPath = join(root, 'template-event.json');
  writeFileSync(eventPath, '{}');
  const output = execFileSync(process.execPath, [STATION], {
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'TashaGandevia/gitquest-stage5-template', GITHUB_API_URL: api.url },
    encoding: 'utf8',
  });
  assert.match(output, /stays offline/);
  assert.equal(api.calls.length, 0);
});
