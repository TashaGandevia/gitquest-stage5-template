// Reads a pull request's proposal out of Git: the record files at its head,
// which paths it changed, who committed, and which station transmissions it
// already contains. Both workflows use this, from a checkout of the default branch.

import { execFileSync } from 'node:child_process';
import { RECORD_PATHS, TRANSMISSION_PREFIX } from './config.mjs';

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function isAncestor(commit, of) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, of]);
    return true;
  } catch {
    return false;
  }
}

export function showFile(commit, path) {
  try {
    return execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// The newest station commit with this transmission number on `ref`, or null.
export function findTransmission(ref, number) {
  const sha = git('log', ref, '-1', '--format=%H', '--fixed-strings', `--grep=${TRANSMISSION_PREFIX}${number}:`);
  return sha || null;
}

export function collectPullRequest(pr, branch) {
  git('fetch', '--no-tags', '--quiet', 'origin', `+refs/pull/${pr.number}/head:refs/remotes/pull/${pr.number}`, `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
  const head = pr.head.sha;
  // The payload's base commit, not today's main: after a merge, main contains
  // the head, and comparing with it would show no changes at all.
  const forkPoint = git('merge-base', pr.base?.sha ?? `origin/${branch}`, head);
  const transmissions = {};
  for (let n = 0; n <= 10; n++) {
    const sha = findTransmission(`origin/${branch}`, n);
    if (sha) transmissions[n] = isAncestor(sha, head);
  }
  return {
    number: pr.number,
    isBot: pr.user?.type === 'Bot',
    headSha: head,
    body: pr.body ?? '',
    headRef: pr.head?.ref ?? '',
    files: Object.fromEntries(RECORD_PATHS.map((path) => [path, showFile(head, path)])),
    changedPaths: git('diff', '--name-only', forkPoint, head).split('\n').filter(Boolean),
    committerEmails: git('log', '--no-merges', '--format=%ce', `${forkPoint}..${head}`).split('\n').filter(Boolean),
    transmissions,
  };
}
