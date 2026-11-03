// A small GitHub REST client for station control, using the workflow's
// GITHUB_TOKEN. Station commits go through the Git Data API so several files
// change in one commit, and GitHub signs them as github-actions[bot].

export function createClient({ token, repository, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const repo = `/repos/${repository}`;

  async function request(method, path, body) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gitquest-station-control',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  async function readFile(path, ref) {
    try {
      const file = await request('GET', `${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function comments(number) {
    return request('GET', `${repo}/issues/${number}/comments?per_page=100`);
  }

  const findMarked = (list, marker) => list.find((c) => c.user?.type === 'Bot' && c.body.includes(`<!-- ${marker} -->`));

  return {
    repository: () => request('GET', repo),
    readFile,

    async ensureLabel(label) {
      try {
        await request('POST', `${repo}/labels`, label);
      } catch (error) {
        if (error.status !== 422) throw error; // already exists
      }
    },

    // Creates the issue unless station control already opened one with this
    // title, so a repeated or resumed run never duplicates a task.
    async ensureIssue(issue) {
      const existing = (await request('GET', `${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(issue.labels[0])}`))
        .find((i) => !i.pull_request && i.title === issue.title && i.user?.type === 'Bot');
      return existing ? existing.number : (await request('POST', `${repo}/issues`, issue)).number;
    },

    getIssue: (number) => request('GET', `${repo}/issues/${number}`),
    updateIssue: (number, fields) => request('PATCH', `${repo}/issues/${number}`, fields),

    comment: (number, body) => request('POST', `${repo}/issues/${number}/comments`, { body }),

    // One comment per marker per issue, edited in place on each run.
    async upsertComment(number, marker, body) {
      const text = `<!-- ${marker} -->\n${body}`;
      const existing = findMarked(await comments(number), marker);
      return existing
        ? request('PATCH', `${repo}/issues/comments/${existing.id}`, { body: text })
        : request('POST', `${repo}/issues/${number}/comments`, { body: text });
    },

    // Posts a story comment only once, however many runs reach this point.
    async commentOnce(number, marker, body) {
      if (findMarked(await comments(number), marker)) return false;
      await request('POST', `${repo}/issues/${number}/comments`, { body: `<!-- ${marker} -->\n${body}` });
      return true;
    },

    hasComment: async (number, marker) => Boolean(findMarked(await comments(number), marker)),

    // Issues (not pull requests) with this label, newest first.
    listIssues: async (label, state = 'open') =>
      (await request('GET', `${repo}/issues?state=${state}&per_page=100&labels=${encodeURIComponent(label)}`)).filter((i) => !i.pull_request),

    // Pull requests a commit belongs to: how a merge on GitHub is told apart from a direct push.
    pullsForCommit: (sha) => request('GET', `${repo}/commits/${sha}/pulls`),

    listClosedPullRequests: () => request('GET', `${repo}/pulls?state=closed&per_page=50&sort=updated&direction=desc`),

    setIssueState: (number, state) =>
      request('PATCH', `${repo}/issues/${number}`, state === 'closed' ? { state, state_reason: 'completed' } : { state }),

    getPullRequest: (number) => request('GET', `${repo}/pulls/${number}`),
    listOpenPullRequests: () => request('GET', `${repo}/pulls?state=open&per_page=100`),
    setPullRequestState: (number, state) => request('PATCH', `${repo}/pulls/${number}`, { state }),

    async findPullRequest(head) {
      const owner = repository.split('/')[0];
      const list = await request('GET', `${repo}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${owner}:${head}`)}`);
      return list[0] ?? null;
    },

    async createPullRequest({ title, head, base, body, labels = [] }) {
      const pr = await request('POST', `${repo}/pulls`, { title, head, base, body });
      if (labels.length) await request('POST', `${repo}/issues/${pr.number}/labels`, { labels });
      return pr;
    },

    listReviews: (number) => request('GET', `${repo}/pulls/${number}/reviews?per_page=100`),
    listReviewComments: (number, reviewId) => request('GET', `${repo}/pulls/${number}/reviews/${reviewId}/comments?per_page=100`),

    async branchSha(branch) {
      try {
        return (await request('GET', `${repo}/git/ref/heads/${branch}`)).object.sha;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },

    createBranch: (branch, sha) => request('POST', `${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha }),

    // A commit status shows on the pull request's checks, like a check run.
    setStatus: (sha, { context, state, description, targetUrl }) =>
      request('POST', `${repo}/statuses/${sha}`, {
        context,
        state,
        description: description.slice(0, 140),
        ...(targetUrl ? { target_url: targetUrl } : {}),
      }),

    // workflow_dispatch is one of the few events GITHUB_TOKEN may trigger, so
    // station control uses it to inspect its own pull request.
    dispatchWorkflow: (workflow, ref, inputs) =>
      request('POST', `${repo}/actions/workflows/${workflow}/dispatches`, { ref, inputs }),

    // `change(read)` returns { [path]: newContent }, reading current files with
    // `read(path)`. Retried if the branch moves underneath us.
    async commit(branch, message, change) {
      for (let attempt = 1; ; attempt++) {
        const ref = await request('GET', `${repo}/git/ref/heads/${branch}`);
        const parent = ref.object.sha;
        const base = await request('GET', `${repo}/git/commits/${parent}`);
        const files = await change((path) => readFile(path, parent));
        const tree = await request('POST', `${repo}/git/trees`, {
          base_tree: base.tree.sha,
          // `null` content deletes the file.
          tree: Object.entries(files).map(([path, content]) => (content === null
            ? { path, mode: '100644', type: 'blob', sha: null }
            : { path, mode: '100644', type: 'blob', content })),
        });
        const commit = await request('POST', `${repo}/git/commits`, { message, tree: tree.sha, parents: [parent] });
        try {
          await request('PATCH', `${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
          return commit.sha;
        } catch (error) {
          if (error.status !== 422 || attempt === 3) throw error;
        }
      }
    },
  };
}
