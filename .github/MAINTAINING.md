# Maintaining the Stage 05 template

For the GitQuest maintainer, not the learner. The story is
*Stage 5: Network — The Next Shift* (M14–M16, provisional numbers).

## Publishing

1. Push this repository to `TashaGandevia/gitquest-stage5-template`. If you
   rename it, change `TEMPLATE_REPOSITORY` in `scripts/lib/config.mjs`.
   Station control and Record checks never run in the template itself.
2. Under **Settings → General**, tick **Template repository**.
3. Leave `.gitquest/progress.json` at step 0 (`schema: 2`).

## What lives where

| File | Role |
|---|---|
| `scripts/station.mjs` | Station control: start/resume, merges, reviews, discrepancy issues |
| `scripts/checks.mjs` | Record checks: `gather`, `validate <part>`, `report` |
| `scripts/lib/story.mjs` | Pure rules: what each step inspects and what a result means |
| `scripts/lib/records.mjs` | Parsers for arrivals, `Name: value` fields, sections, the report |
| `scripts/lib/content.mjs` | Station-authored record text: notices, Mika's draft, the bay report |
| `scripts/lib/messages.mjs` | Every issue, comment and pull request body |
| `scripts/lib/inspection.mjs` | Posting a result: comment, statuses, story reactions |

## Message style

Every task issue (and Mika's pull request) uses the same layout:

1. **# Comms:** character cards (the coloured name, then the message, in a
   bordered table cell; see **Look** below), then an optional quoted intro.
2. **# Your Tasks:** `## Task 1`, `## Task 2`, ... Each has its checkbox, the
   explanation and commands in a quote box, then any screenshot or alert.
3. **# Notes:** after a rule, the three-level **Stuck?** hints and any
   "why" folds or examples.

Comments (confirmations, Record checks results, recovery checklists) are
character cards, with Caution or Warning boxes for problems.

Task text is in `STEPS` in `scripts/lib/missions.mjs` (the `layout({ comms,
intro, tasks, notes })` call for each task); character names and colours are in
`CAST` and `COLOURS` in `scripts/lib/messages.mjs`. To see a change rendered,
make a fresh copy of the template and play to that task, or paste the issue's
Markdown into any GitHub issue or comment preview.

## Story flow

Every step is its **own small issue** (label `task`), opened when the step
before it is done, so there is always exactly one current issue. Each uses
the layout in **Message style** above: the story in **# Comms**, numbered
tasks in **# Your Tasks** (each a checkbox, the explanation and commands in a
quote box, then any `[SCREENSHOT]: ...` line with its image), and hints in
**# Notes**.

The player ticks every box. When station control sees a step is done, the
character who'd notice confirms it **on that step's issue**, links the next
one, and mentions the player so GitHub notifies them. The player closes each
issue themselves, except the one their pull request closes with `Closes #N`
(14.2, 15.1, 16.3, and 16.R). Station control never edits or closes a step
issue.

| Step | Confirmed when station control sees | Teaches |
|---|---|---|
| 14.1 Take the request | A push of a branch that changes the plan (Mika nudges if the player never assigned themselves) | Issues, assigning, task lists, branch, commit, `push -u` (upstream), closing an issue, what **Run workflow** did |
| 14.2 Open a pull request | A pull request changing the plan | Pull requests, `Closes #N` |
| 14.3 Check and merge | A valid merge → T1 hold notice | Record checks (automatic), merging, deleting the branch |
| 15.1 Send the handover draft | A pull request changing the handover | Pull, new branch |
| 15.2 Fix the failed check | The handover format passing (skipped if it already passes) | Actions logs, CI, pushing to an open PR |
| 15.3 Report the discrepancy | A valid Record discrepancy issue (T2) | Issue forms, labels |
| 15.4 Answer the review and merge | A valid merge with the discrepancy on record → T3 notices, Mika's PR (T4/T5) | Answering review, closing keywords |
| 16.1 Review Mika's pull request | **Request changes** naming 22:25 → T6 correction, T7 | Formal review |
| 16.2 Approve and merge | Mika's PR merged with the correction | Approve vs merge |
| 16.2 Repair *(only if Mika's PR merged early)* | The repair PR merged (T10) | Recovery without deleting history |
| 16.3 Write the final handover | A pull request changing the handover | Independent PR |
| 16.4 Hand it over | A valid merge → T9, `completion.md`, closing messages | |

Every move commits `[station] T11: step <key> opened as #N`, and posts "Next
step" on the pull request that caused it.

## Look

GitHub strips CSS from issues and comments, but its maths rendering accepts
`\color{#RRGGBB}` (not `\color[HTML]{...}`, which fails with "Color model
'HTML' not defined"). Colours are in `COLOURS` in `scripts/lib/messages.mjs`.

- **Characters:** a bordered one-cell table with the name in GitQuest's colour,
  `$\color{#CBBD6A}{\Large\textbf{Mika}}$`, then the message. Mika `#CBBD6A`,
  Voss `#D99D5B`, Station Control / Maintenance / Docking `#39E7B1`.
- **Problems:** GitHub's built-in alert boxes. **Caution** (red) for failures
  that must be fixed, a fault in station equipment, or a record merged too
  early; **Warning** (yellow) for things that don't block a merge, an undone
  push to `main`, an incomplete discrepancy, or a missing setting. Inside
  them, `FAIL` is `#FF8E98` and `WARNING` / `NOTE` are `#F2C66D`.
- **Important asides** inside a task (e.g. "Typed plain `git push` by
  mistake?"): the purple **Important** box around a fold.

## Screenshots

Each `[SCREENSHOT]: ...` line in a task issue has an image under it, loaded
from `.github/screenshots/<name>.png` in the learner's own copy. How to
replace, add, rename or describe them, the naming rules, and the list of
images in use are in [`.github/screenshots/README.md`](screenshots/README.md).

## README progress and badges

Every time station control saves progress, it rewrites two marked sections of
the learner's `README.md` (between `<!-- gitquest:badges:start/end -->` and
`<!-- gitquest:progress:start/end -->`; the rest is never touched):

- **Badges** at the top: one card per mission, `Locked` until that mission is
  done, then `Earned`. Images are `.github/badges/<id>-locked.svg` and
  `-earned.svg`, drawn by `node scripts/make-badges.mjs` from
  `scripts/lib/badges.mjs`.
- **Your shift:** every task with Done / **Current** / Up next, linked to its
  issue.

## GitQuest completion code

When the stage completes, station control:

1. Makes a **12-character code** from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no
   0/O or 1/I/L), with `crypto.randomInt`. It is made once and kept in
   `progress.completion.code`; repeated runs reuse it.
2. Writes `.gitquest/completion.json` on `main` (in the `[station] T9` commit):

   ```json
   {
     "schema": 1,
     "stage": 5,
     "code": "K7M2PX9QW4TR",
     "repository": "owner/name",
     "completedAt": "2026-11-03T23:59:00.000Z",
     "badges": ["m14-on-the-other-end", "m15-read-the-result", "m16-second-pair-of-eyes"],
     "finalMergeCommit": "…",
     "steps": { "14.1": 1, "…": "…" },
     "pullRequests": { "plan": 3, "…": "…" }
   }
   ```

3. Opens a **Shift report · Your GitQuest code** issue with the code and a
   link to `GITQUEST_REDEEM_URL?repo=<owner/name>&code=<code>` (set the real
   URL in `scripts/lib/config.mjs`). It isn't a task: the stage is already
   complete, and closing it is optional.

### What GitQuest needs to do to redeem it

| # | Requirement |
|---|---|
| 1 | Accept the **code** (12 characters; trim spaces, ignore case and dashes) and the **repository** (`owner/name`, from the link or typed in) |
| 2 | Read `.gitquest/completion.json` from the repository's default branch (public: `GET /repos/{repo}/contents/.gitquest/completion.json`, or raw.githubusercontent.com). Reject if missing |
| 3 | Check `schema == 1`, `stage == 5`, `code` matches, `repository` matches the repository asked about (ignoring case) |
| 4 | Check the repository was made from the template: `GET /repos/{repo}` → `template_repository.full_name` is the published template |
| 5 | Check the history: the latest commit touching `completion.json` is a `[station] T9:` commit by `github-actions[bot]`, and `[station] T0`–`T3` exist before it |
| 6 | **One-time use:** store each redemption (code, repository, GitQuest user, time). Reject a code that has been redeemed, and a repository already redeemed by another user |
| 7 | Award the badges listed in `badges` (ids match `scripts/lib/badges.mjs`), plus any stage badge (e.g. Next Shift Ready) |
| 8 | Show a clear reason on rejection: no file, wrong code, already used, not from the template |

**Limits.** The learner owns their repository, including its workflows, so a
determined learner could write a matching `completion.json` themselves. The
checks above (template origin, bot-authored station history, one-time use)
make that a lot of work, not impossible. Treat it as progress evidence.

## Two results on the handover PR

- **Record checks** is the workflow's own check run on the PR head. For Mika's
  PR it's a commit status instead, because that run is dispatched against `main`.
- **Handover readiness** is a commit status set by Record checks and by station
  control when the discrepancy is filed. It's `pending` until the instruction is
  explicit, the discrepancy is on record and the PR links it.

## Recovery

Recovery follows the story's own pattern: notice the mistake, a character
explains it without blame, the record is put back **with a new commit** (never
a history rewrite), and a "Do this instead" checklist is posted in the same
format as a step.

| Mistake | What happens |
|---|---|
| Push straight to `main` changing a record (CLI or web editor) | `[station] T12` restores the changed `docking-log/` files to their state before the push. Voss comments on the mission issue with a checklist: pull, new `<branch>-2` branch, redo the change, `push -u`, PR. Pushes that belong to a merged PR (`GET /commits/{sha}/pulls`, or a closed PR's `merge_commit_sha`) are left alone |
| PR merged with content failures | The PR's task issue is reopened; Voss comments on the PR with what's wrong (Caution box) and the same checklist. To make this rarer, every learner PR gets a "don't merge yet" note when it opens, M15.1 has a wait-for-checks task, and Station control's check entry is named **Story update (not a check)** |
| GitHub **Revert** PR (branch `revert-<n>-…`, body `Reverts owner/repo#<n>`) | Not inspected as a task. Voss recommends closing it and fixing forward, with the checklist. If merged, it's recorded in `progress.handled` and never treated as a bad merge |
| `git pull` diverges | A fold in every "Start from the latest main" step and in the checklists: move the commit to `rescued-work`, `git reset --hard origin/main` |
| Mika's PR merged before her fix | Repair checklist posted on M16 |

Not handled: a direct push that breaks `scripts/` or `.github/` on `main`.
Station control runs from `main`, so it can't repair its own equipment.

**Lost runs.** Station control runs one at a time, and GitHub keeps only one
run waiting: a newer event replaces it. Two defences:

- Events that never matter don't start a run at all: ticking boxes in station
  control's own issues, deleting a branch, or commenting on an issue.
- Every run ends by catching up on any merged pull request that completes the
  current mission but wasn't handled (handled merges are listed in
  `progress.handled`).

**Run workflow** on Station control is the universal resume. It:

- reopens the current task if it was closed by hand,
- processes a merged PR whose event was missed,
- records a valid discrepancy whose event was missed,
- creates Mika's branch/PR if creation failed, reopens it if it was closed,
- applies a correction if a qualifying review was missed,
- re-dispatches Record checks for Mika's PR,
- and writes the current task's link to the run summary.

Issues and Mika's PR are found by title/branch before being created, so a
repeated run never duplicates them.

## Evidence for GitQuest's clone check

A clone contains files and history only; not issues, reviews or Actions runs.

- `origin` is the learner's repository, not the template.
- `.gitquest/progress.json` has `"step": 6, "complete": true`.
- `.gitquest/completion.md` lists the task issues, PRs and commit IDs. It's
  learner-editable: progress evidence, not certification.
- `[station] T0`, `T1`, `T3`, `T9` exist on `origin/main`, committed by
  `github-actions[bot]`. For stricter checking, verify their GitHub signatures.
- **Pull:** the learner's handover commit has T1 as an ancestor.
- **PRs:** "Merge pull request #n" commits bring in the plan, handover and summary.
- **Review:** T6 (the correction) is on `main`, or T10 (repair) exists.
- Final files: the Aster arrival line, `Maintenance released Bay 3 at 22:25.`,
  and the Summary headings in the handover.

## GitQuest-side content (not in this repo)

The departure briefing (Voss/Mika dialogue), the setup page, badges (**On the
Other End**, **Read the Result**, **Second Pair of Eyes**, **Next Shift Ready**)
and the debrief questions live in GitQuest. No new rank: Archivist is Stage 6.

## Not yet verified on GitHub

The tests run the scripts against real Git repositories and a fake API. Check
these on a throwaway repository created from the template:

- **Actions → Station control → Run workflow** appears in a new repository and
  `GITHUB_TOKEN` gets the declared write permissions.
- With **Allow GitHub Actions to create and approve pull requests** off, opening
  Mika's PR returns 403 and the permission task appears; after the change,
  **Run workflow** opens it.
- A `workflow_dispatch` sent with `GITHUB_TOKEN` starts Record checks, and its
  commit status shows on Mika's PR.
- `pull_request_review` runs for a review on a bot-authored PR, and its payload's
  `review.state` is lowercase (`changes_requested`).
- An issue form with `labels:` fires `opened` with the label already in the
  payload (the `labeled` run is harmless: the same handler is idempotent).
- `refs/pull/<n>/head` can still be fetched after a merge with branch deletion.
- Closing keywords in the PR body close both issues on merge into `main`.

## Tests

```bash
node --test scripts/test/*.test.mjs
```

(Passing the directory, `node --test scripts/test/`, doesn't work on Node 22.)
