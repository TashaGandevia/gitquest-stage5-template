// Publishing an inspection: the single Record checks comment on a pull
// request, the Handover readiness status, and the scripted story reactions
// that depend on what the current revision proved. Used by Record checks
// and, after a discrepancy is filed, by station control.

import { HANDOVER_PATH, READINESS_CONTEXT, RECORD_CHECKS_CONTEXT } from './config.mjs';
import * as messages from './messages.mjs';
import { parseFields, sections } from './records.mjs';
import { HANDOVER_FIELDS, STEP, allFindings, checksPassed, failing, instructionIsExplicit, passed } from './story.mjs';

export const MARKERS = {
  inspection: 'gitquest:inspection',
  mikaPlanReady: 'gitquest:mika-plan-ready',
  vossFailed: 'gitquest:voss-failed-check',
  mikaReview: 'gitquest:mika-review',
  mikaReady: 'gitquest:mika-handover-ready',
  vossFinal: 'gitquest:voss-final-ready',
};

function readinessStatus(findings) {
  const missing = failing(findings);
  if (missing.length === 0) return { state: 'success', description: 'Format, evidence and links agree. Ready to merge.' };
  const first = missing[0].text.replace(/[`*]/g, '');
  return { state: 'pending', description: `Waiting: ${first}` };
}

// `pr` is { number, headSha, files }. `statusForChecks` is true when this run
// can't attach a check run to the head commit itself (a dispatched run), so
// the result is posted as a commit status instead.
export async function publishInspection({ gh, progress, evaluation, pr, runUrl, statusForChecks = false }) {
  const sha = pr.headSha;
  const checksOk = checksPassed(evaluation);
  const passedAll = checksOk && (!evaluation.readiness || passed(evaluation.readiness));
  await gh.upsertComment(pr.number, MARKERS.inspection, messages.inspectionReport({ evaluation, sha, runUrl, passedAll: checksOk }));

  if (statusForChecks) {
    await gh.setStatus(sha, {
      context: RECORD_CHECKS_CONTEXT,
      state: checksOk ? 'success' : 'failure',
      description: checksOk ? 'Record checks passed for this revision' : 'Record checks found a problem. Open the details.',
      targetUrl: runUrl,
    });
  }
  if (evaluation.readiness) {
    await gh.setStatus(sha, { context: READINESS_CONTEXT, ...readinessStatus(evaluation.readiness), targetUrl: runUrl });
  }

  // Story reactions. Each posts at most once per pull request.
  if (evaluation.review) return { checksOk, passedAll };
  const step = progress.step;
  if (step === STEP.PLAN && checksOk) {
    await gh.commentOnce(pr.number, MARKERS.mikaPlanReady, messages.mikaPlanReady);
  }
  if (step === STEP.HANDOVER) {
    const handover = evaluation.parts.find((p) => p.id === 'handover');
    const formatOk = passed(handover.findings);
    if (!formatOk) {
      await gh.commentOnce(pr.number, MARKERS.vossFailed, messages.vossFailedCheck);
    } else {
      const caughtEarly = !(await gh.hasComment(pr.number, MARKERS.vossFailed));
      const night = sections(pr.files[HANDOVER_PATH] ?? '')['Night shift'] ?? '';
      const alreadyExplicit = instructionIsExplicit(parseFields(night, HANDOVER_FIELDS).fields.Instruction);
      await gh.commentOnce(pr.number, MARKERS.mikaReview, messages.mikaSemanticReview({ caughtEarly, alreadyExplicit }));
    }
    if (passedAll) await gh.commentOnce(pr.number, MARKERS.mikaReady, messages.mikaHandoverReady);
  }
  if (step === STEP.FINAL && passed(allFindings(evaluation))) {
    await gh.commentOnce(pr.number, MARKERS.vossFinal, messages.vossFinalReady);
  }
  return { checksOk, passedAll };
}
