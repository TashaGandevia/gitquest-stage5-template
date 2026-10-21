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

    async createIssue(issue) {
      return (await request('POST', `${repo}/issues`, issue)).number;
    },

    comment: (number, body) => request('POST', `${repo}/issues/${number}/comments`, { body }),

    // One comment per marker per issue, edited in place on each run.
    async upsertComment(number, marker, body) {
      const text = `<!-- ${marker} -->\n${body}`;
      const comments = await request('GET', `${repo}/issues/${number}/comments?per_page=100`);
      const existing = comments.find((c) => c.user?.type === 'Bot' && c.body.includes(`<!-- ${marker} -->`));
      return existing
        ? request('PATCH', `${repo}/issues/comments/${existing.id}`, { body: text })
        : request('POST', `${repo}/issues/${number}/comments`, { body: text });
    },

    setIssueState: (number, state) =>
      request('PATCH', `${repo}/issues/${number}`, state === 'closed' ? { state, state_reason: 'completed' } : { state }),

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
          tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
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
