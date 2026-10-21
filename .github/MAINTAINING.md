# Maintaining the Stage 05 template

For the GitQuest maintainer, not the learner.

## Publishing

1. Push this repository to `TashaGandevia/gitquest-stage5-template`. If you
   rename it, change `TEMPLATE_REPOSITORY` in `scripts/lib/config.mjs`.
   Station control never runs in the template itself.
2. Under **Settings → General**, tick **Template repository**.
3. Leave `.gitquest/progress.json` at step 0.

## Mission flow

| Step | Learner does | Station control reacts | Teaches |
|---|---|---|---|
| 0 | Creates the repository from the template | First push (or **Run workflow**) creates labels, opens task 1 and writes T0 | Templates, Actions |
| 1 | Branch, adds Kestrel, pushes, opens a PR with `Closes #n`, merges | Inspection on the PR. On a passing merge, T1 adds Osprey `Inbound` to `main` and opens task 2 | Credentials, clone, push, issues, PRs |
| 2 | Pulls `main`, branches, sets Osprey `Docked`, PR, merges | Inspection requires T1 in the branch. On merge, T2 adds Heron and opens task 3 | Pull |
| 3 | Opens an issue with the Fault report template | T3 logs Plover on `main`, comments instructions, closes task 3 | Issues, templates, labels |
| 4 | Adds the resolved fault line on `main`, commits with `Fixes #n`, pushes. The push is rejected, so they pull, then push again | On a passing push, T4 sets step 5 and comments that the mission is complete | Push rejection, pull, closing keywords |

Each station commit message starts with `[station] T<n>:`. The inspector and
GitQuest use that marker to find transmissions.

## Evidence for GitQuest's BrowserPod check

These can all be read from a public clone, without the GitHub API or a token:

- `origin` is the learner's repository, not the template.
- `.gitquest/progress.json` has `"step": 5, "complete": true`.
- `T0`–`T4` exist on `origin/main`, committed by `github-actions[bot]`.
- The learner's commits have committers other than `noreply@github.com`,
  which proves they pushed from their own machine with working credentials.
- **Pull:** the learner's Osprey commit has T1 as an ancestor, and their
  fault-fix commit has T3 as an ancestor.
- **PRs:** commits titled "Merge pull request #n" bring in the Kestrel and
  Osprey changes. A squash merge won't have one. Decide whether to accept that.
- The files under `docking-log/` match the expected final lines.

`progress.json` can be edited by hand. To make the check stricter, verify the
T commits' GitHub signatures (`git verify-commit` with GitHub's web-flow key),
and check that T4 changed the file.

## Not yet verified on GitHub

The local tests cover parsing and the inspection rules only. The workflows
have not run on GitHub. Check these on a throwaway repository:

- Creating a repository from the template triggers `push` for the initial commit.
- Workflows can raise `GITHUB_TOKEN` to the write permissions they declare in
  a newly created personal repository.
- Issues and Actions are enabled in a repository created from the template.
- Git Data API commits made with `GITHUB_TOKEN` are authored by
  `github-actions[bot]` and show as Verified.
- Opening an issue from a template that adds a label fires both `opened` and
  `labeled`. The second run sees step 4 and does nothing.
- The concurrency group keeps only one pending run. A burst of three or more
  events can cancel a queued one. Running the workflow by hand recovers step 0,
  but nothing recovers the later steps yet.
- `refs/pull/<n>/head` can still be fetched after a merge with branch deletion
  (the inspection depends on it).

## Tests

```bash
node --test scripts/test/
```
