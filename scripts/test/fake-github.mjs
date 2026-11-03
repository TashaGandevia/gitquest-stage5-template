// An in-memory GitHub API for the integration tests: enough of issues,
// comments, pull requests, reviews, statuses, dispatches and the Git Data API
// for station control and Record checks. Every request is recorded in `calls`.

import { createServer } from 'node:http';

export function startFakeGitHub({ repository, files }) {
  const calls = [];
  const state = {
    snapshots: { m0: { ...files } }, // commit sha → { path: text }
    commits: { m0: { message: 'Initial commit', tree: 'm0' } },
    branches: { main: 'm0' },
    trees: {},
    issues: [], // issues and pull requests share numbers, as on GitHub
    pulls: [],
    comments: {},
    reviews: {},
    reviewComments: {},
    statuses: [],
    dispatches: [],
    labels: [],
    subIssues: {},
    refusePulls: false,
    next: 1,
    nextId: 1000,
  };

  const repoPath = `/repos/${repository}`;
  const resolve = (ref) => state.snapshots[state.branches[ref] ?? ref] ?? {};
  const bot = { type: 'Bot', login: 'github-actions[bot]' };

  function issue(number) {
    return state.issues.find((i) => i.number === number) ?? state.pulls.find((p) => p.number === number);
  }

  // Station commits, readable in a test: [{ branch, message, files }].
  state.stationCommits = [];

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url, 'http://x');
      const path = decodeURIComponent(url.pathname);
      calls.push({ method: req.method, path, query: url.searchParams, body });
      const send = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(status === 204 ? undefined : JSON.stringify(value ?? {}));
      };
      if (!path.startsWith(repoPath)) return send(404);
      const p = path.slice(repoPath.length);
      const q = url.searchParams;
      let m;

      if (req.method === 'GET' && p === '') return send(200, { is_template: false, default_branch: 'main' });
      if (req.method === 'POST' && p === '/labels') {
        if (state.labels.includes(body.name)) return send(422);
        state.labels.push(body.name);
        return send(201, body);
      }

      // Contents
      if (req.method === 'GET' && (m = p.match(/^\/contents\/(.+)$/))) {
        const text = resolve(q.get('ref') ?? 'main')[m[1]];
        return text == null ? send(404) : send(200, { content: Buffer.from(text).toString('base64') });
      }

      // Issues
      if (req.method === 'GET' && p === '/issues') {
        const label = q.get('labels');
        const wanted = q.get('state') ?? 'open';
        return send(200, [...state.issues]
          .filter((i) => !label || i.labels.some((l) => l.name === label))
          .filter((i) => wanted === 'all' || i.state === wanted)
          .reverse());
      }
      if (req.method === 'POST' && p === '/issues') {
        const created = { id: 90000 + state.next, number: state.next++, title: body.title, body: body.body, labels: (body.labels ?? []).map((name) => ({ name })), state: 'open', user: bot };
        state.issues.push(created);
        return send(201, created);
      }
      if ((m = p.match(/^\/issues\/(\d+)$/))) {
        const found = issue(Number(m[1]));
        if (!found) return send(404);
        if (req.method === 'PATCH') Object.assign(found, body);
        return send(200, found);
      }
      if (req.method === 'POST' && (m = p.match(/^\/issues\/(\d+)\/sub_issues$/))) {
        const child = state.issues.find((i) => i.id === body.sub_issue_id);
        (state.subIssues[m[1]] ??= []).push(child.number);
        return send(201, issue(Number(m[1])));
      }
      if ((m = p.match(/^\/issues\/(\d+)\/comments$/))) {
        const list = (state.comments[m[1]] ??= []);
        if (req.method === 'GET') return send(200, list);
        const comment = { id: state.nextId++, body: body.body, user: bot };
        list.push(comment);
        return send(201, comment);
      }
      if (req.method === 'PATCH' && (m = p.match(/^\/issues\/comments\/(\d+)$/))) {
        const comment = Object.values(state.comments).flat().find((c) => c.id === Number(m[1]));
        comment.body = body.body;
        return send(200, comment);
      }
      if (req.method === 'POST' && (m = p.match(/^\/issues\/(\d+)\/labels$/))) {
        issue(Number(m[1])).labels = body.labels.map((name) => ({ name }));
        return send(200, []);
      }

      // Pull requests
      if (req.method === 'GET' && p === '/pulls') {
        const head = q.get('head')?.split(':')[1];
        const wanted = q.get('state') ?? 'open';
        return send(200, [...state.pulls]
          .filter((pr) => !head || pr.head.ref === head)
          .filter((pr) => wanted === 'all' || pr.state === wanted)
          .reverse());
      }
      if (req.method === 'POST' && p === '/pulls') {
        if (state.refusePulls) return send(403, { message: 'GitHub Actions is not permitted to create or approve pull requests.' });
        const pr = {
          number: state.next++,
          title: body.title,
          body: body.body,
          state: 'open',
          merged: false,
          user: bot,
          labels: [],
          head: { ref: body.head, sha: state.branches[body.head] },
          base: { ref: body.base, sha: state.branches[body.base] },
        };
        state.pulls.push(pr);
        return send(201, pr);
      }
      if ((m = p.match(/^\/pulls\/(\d+)$/))) {
        const pr = state.pulls.find((x) => x.number === Number(m[1]));
        if (!pr) return send(404);
        if (req.method === 'PATCH') Object.assign(pr, body);
        if (pr.user.type === 'Bot' && state.branches[pr.head.ref]) pr.head.sha = state.branches[pr.head.ref];
        return send(200, pr);
      }
      if (req.method === 'GET' && (m = p.match(/^\/commits\/(.+)\/pulls$/))) {
        return send(200, state.pulls.filter((pr) => pr.merge_commit_sha === m[1] || pr.mergeSha === m[1]));
      }
      if (req.method === 'GET' && (m = p.match(/^\/pulls\/(\d+)\/reviews$/))) return send(200, state.reviews[m[1]] ?? []);
      if (req.method === 'GET' && (m = p.match(/^\/pulls\/\d+\/reviews\/(\d+)\/comments$/))) return send(200, state.reviewComments[m[1]] ?? []);

      // Git Data API
      if (req.method === 'GET' && (m = p.match(/^\/git\/ref\/heads\/(.+)$/))) {
        const sha = state.branches[m[1]];
        return sha ? send(200, { object: { sha } }) : send(404);
      }
      if (req.method === 'POST' && p === '/git/refs') {
        state.branches[body.ref.replace('refs/heads/', '')] = body.sha;
        return send(201, {});
      }
      if (req.method === 'GET' && (m = p.match(/^\/git\/commits\/(.+)$/))) {
        const commit = state.commits[m[1]];
        return commit ? send(200, { sha: m[1], message: commit.message, tree: { sha: commit.tree } }) : send(404);
      }
      if (req.method === 'POST' && p === '/git/trees') {
        const sha = `t${state.nextId++}`;
        state.trees[sha] = body;
        return send(201, { sha });
      }
      if (req.method === 'POST' && p === '/git/commits') {
        const sha = `c${state.nextId++}`;
        const tree = state.trees[body.tree];
        const snapshot = { ...state.snapshots[body.parents[0]] };
        for (const entry of tree.tree) {
          if (entry.sha === null) delete snapshot[entry.path];
          else snapshot[entry.path] = entry.content;
        }
        state.snapshots[sha] = snapshot;
        state.commits[sha] = { message: body.message, tree: body.tree, entries: tree.tree };
        return send(201, { sha });
      }
      if (req.method === 'PATCH' && (m = p.match(/^\/git\/refs\/heads\/(.+)$/))) {
        state.branches[m[1]] = body.sha;
        const commit = state.commits[body.sha];
        state.stationCommits.push({ branch: m[1], sha: body.sha, message: commit.message, files: Object.fromEntries(commit.entries.map((e) => [e.path, e.content])) });
        return send(200, {});
      }

      if (req.method === 'POST' && (m = p.match(/^\/statuses\/(.+)$/))) {
        state.statuses.push({ sha: m[1], ...body });
        return send(201, {});
      }
      if (req.method === 'POST' && (m = p.match(/^\/actions\/workflows\/(.+)\/dispatches$/))) {
        state.dispatches.push({ workflow: m[1], ...body });
        return send(204);
      }
      return send(404, { message: `fake: no route for ${req.method} ${p}` });
    });
  });

  return new Promise((done) => server.listen(0, '127.0.0.1', () =>
    done({ server, calls, state, url: `http://127.0.0.1:${server.address().port}` })));
}
