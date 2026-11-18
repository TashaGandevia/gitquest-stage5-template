# Ring A Docking Log · December 8, 2085

<!-- gitquest:badges:start -->
<p>
<img src=".github/badges/m14-on-the-other-end-locked.svg" width="300" alt="On the Other End: locked">
<img src=".github/badges/m15-read-the-result-locked.svg" width="300" alt="Read the Result: locked">
<img src=".github/badges/m16-second-pair-of-eyes-locked.svg" width="300" alt="Second Pair of Eyes: locked">
</p>
<!-- gitquest:badges:end -->

The Aster is bringing Ring A's relief crew, and it's running late. Tonight you
work from your own computer. Docking, Maintenance and Continuity leave requests
here; you send your changes back with Git.

> Voss, Mika and the notices are **scripted training characters**, posted by
> GitHub's Actions bot. Nobody is reading in real time.

<!-- gitquest:progress:start -->
## Your shift

Not started yet. Open **Actions → Station control → Run workflow** to begin.
<!-- gitquest:progress:end -->

## Quick start

Playing from GitQuest? Its **M14** page walks you through every step below,
with help for Windows, macOS and Linux. Tick them off there.

1. **Make your copy:** **Use this template → Create a new repository**, set to
   **Public**. GitQuest can only read a public repository.
2. **Allow pull requests from Actions:** in your copy, **Settings → Actions → General**,
   choose **Read and write permissions**, tick **Allow GitHub Actions to create and approve pull requests**, and save.
   A new copy has neither, and M16 needs both.
3. **Get Git ready** on your computer, with an SSH key for this repository. [How?](#setting-up-git)
4. **Clone your copy** (not the template), and open the folder in your editor.
5. **Start the shift:** **Actions → Station control → Run workflow**. Your first task, **M14.1**, appears under **Issues**.
6. **Link it to GitQuest:** GitQuest gives you a claim token to comment on any
   issue here. [More](#linking-this-repository-to-gitquest)

That's all you need. Everything else is explained as you go, in the story.

<img width="1691" height="1272" alt="Template repository settings" src="https://github.com/user-attachments/assets/b702ca5c-5042-432e-bb6e-8adb48f55807" />
*Creating your copy from the template*

## Where things are

| Tab | What's there |
|---|---|
| **Issues** | Your tasks, one small issue each (M14.1, M14.2, ...). Tick the boxes yourself and close each one when someone on shift confirms it |
| **Pull requests** | Changes waiting to be read and merged |
| **Actions** | Automatic jobs: **Station control** runs the story, **Record checks** checks your records |
| **Code** | The files |

## Setting up Git

GitQuest's M14 page has these steps with help for each system. In short, you
need two things: a **name and email** for your commits, and a way to **sign
in** to GitHub when you push. They're separate.

```bash
git config --global user.name "Your Name"
```

```bash
git config --global user.email "you@example.com"
```

To sign in, make an SSH key just for this shift and add its `.pub` half to
GitHub (**Settings → SSH and GPG keys → New SSH key**):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gitquest_ed25519
```

The clone below tells this one folder to use that key, so nothing else on your
computer changes and no password or token is saved.

Never paste a password, token or private key into GitQuest, an issue, or a file here.

<details>
<summary><strong>Cloning, and checking you cloned the right one</strong></summary>

On **your** repository's page, choose **Code → SSH**, copy the address, then:

```bash
git clone -c core.sshCommand="ssh -i ~/.ssh/gitquest_ed25519 -o IdentitiesOnly=yes" git@github.com:YOUR-NAME/YOUR-REPOSITORY.git
```

Inside the new folder, `git remote -v` should show **your** repository. If it
shows the template, clone your copy instead.

<img width="1690" height="1256" alt="Clone options" src="https://github.com/user-attachments/assets/ec8e6d12-9030-484a-8404-190ba0fee64d" />

</details>

## If you get stuck

Every step has a **Stuck?** section with three levels of hints. Mistakes are
part of the shift: nothing here needs you to delete the repository.

| Problem | Fix |
|---|---|
| No first mission, or lost your place | **Actions → Station control → Run workflow**. Its summary links where you are. |
| `git push` says "no upstream branch" | First push of a new branch: `git push -u origin BRANCH-NAME` |
| A check failed | Open **Details** next to **Record checks**, read the red step, fix, commit, push. |
| Pushed or merged straight to `main` | Station control undoes it (your commit stays in the history) and Voss posts a checklist: pull, new branch, pull request. |
| Merged a pull request too early | Voss reopens the task with a checklist for a new pull request. Wait for **Record checks** before merging: the green **Story update** tick isn't a check of your record. |
| Pressed GitHub's **Revert** on a merged pull request | Allowed, but not needed. Voss suggests closing it and fixing forward with a new pull request; merging it is fine too. |
| `git pull` says *divergent branches* or *Not possible to fast-forward* | You committed on `main` by mistake. Every "Start from the latest main" step has a fold that moves the commit to a branch. |
| Deleted a branch before its pull request merged | If it's still on your computer, push it again: `git push -u origin BRANCH-NAME`. |
| Closed a mission by hand | **Run workflow**. It reopens what isn't finished. |

Every task is a safe place to stop. Come back any time.

<details>
<summary><strong>Record formats (reference)</strong></summary>

| File | Format |
|---|---|
| `docking-log/arrivals.md` | `2085-12-08 22:40 \| Aster \| Bay 3` |
| `docking-log/plans/aster.md` | `Ship`, `Date`, `Expected`, `Proposed bay`, `Status`, `Condition` as `Name: value` |
| `docking-log/handover/2085-12-08.md` | `Ship`, `Expected`, `Bay`, `Bay status` (`Hold` or `Released`), `Instruction` |
| `docking-log/notices/` | Station-authored. Read them; don't edit them |

Times are always 24-hour `HH:MM`, like `22:40`. Only change the file your task
names; `.github/`, `scripts/` and `.gitquest/` are station equipment.

</details>

## Linking this repository to GitQuest

On M14's page, GitQuest asks for this repository's name and gives you a claim
token like `gitquest-claim-…`. Comment it on **any issue** here, from your own
account, then check it in GitQuest. That's how GitQuest knows the repository
is yours. Station control ignores the comment: it isn't a reply to a task.

## Your GitQuest codes

Each mission ends with a code from Station control: M14's and M15's on the
pull request that finished them, M16's in the **Shift report** issue. They're
also listed under the badges at the top of this README. Enter each on that
mission's page in GitQuest to complete it there.

The codes aren't secret: anyone can read this repository. They only count for
the GitQuest player who linked it.

## When you're done

Station control posts **Stage complete**. To start over, delete this
repository and make a new copy (and link the new one in GitQuest).
