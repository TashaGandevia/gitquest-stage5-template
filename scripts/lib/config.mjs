// Fixed facts about the December 8 shift pack: where records live, which
// paths are station equipment, labels, and the station's commit markers.

// The repository GitQuest publishes as the template. Station control never
// runs there, even before the "Template repository" setting is ticked.
export const TEMPLATE_REPOSITORY = 'TashaGandevia/gitquest-stage5-template';

export const PROGRESS_PATH = '.gitquest/progress.json';
export const COMPLETION_PATH = '.gitquest/completion.md';
export const COMPLETION_JSON_PATH = '.gitquest/completion.json';
export const README_PATH = 'README.md';

// Where the player redeems their completion code. Station control adds
// ?repo=<owner/name>&code=<code> to the link. Change it to GitQuest's real page.
// TODO This needs a link and to be set up within GitQuest
export const GITQUEST_REDEEM_URL = 'https://gitquest.example/redeem';

// Completion codes use letters and digits that can't be confused when copied
// by eye: no 0/O or 1/I/L.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 12;

export const ARRIVALS_PATH = 'docking-log/arrivals.md';
export const PLAN_PATH = 'docking-log/plans/aster.md';
export const HANDOVER_PATH = 'docking-log/handover/2085-12-08.md';
export const REPORT_PATH = 'docking-log/reports/bay-3.md';
export const MAINTENANCE_NOTICES_PATH = 'docking-log/notices/maintenance-2085-12-08.md';
export const DOCKING_NOTICES_PATH = 'docking-log/notices/docking-2085-12-08.md';

// Every record file the inspection may read from a proposal.
export const RECORD_PATHS = [ARRIVALS_PATH, PLAN_PATH, HANDOVER_PATH, REPORT_PATH];

// Station equipment and station-authored notices. A learner proposal that
// touches any of these fails inspection.
export const PROTECTED_PATHS = ['.github/', 'scripts/', '.gitquest/', '.gitattributes', 'docking-log/notices/'];

// The branch station control uses for the pull request the learner reviews.
export const REVIEW_BRANCH = 'station/aster-arrival';

export const RECORD_CHECKS_WORKFLOW = 'record-checks.yml';
export const READINESS_CONTEXT = 'Handover readiness';
export const RECORD_CHECKS_CONTEXT = 'Record checks';

// GitHub's web editor and its merge / "Update branch" buttons commit with this
// email. It is only a hint about where a commit was made, never proof.
export const WEB_COMMITTER_EMAIL = 'noreply@github.com';

export const LABELS = [
  { name: 'task', color: '1d76db', description: 'One task of a mission (M14.1, M14.2, ...)' },
  { name: 'record-discrepancy', color: 'd93f0b', description: 'A record that disagrees with its evidence' },
  { name: 'station', color: '5319e7', description: 'Opened by station control' },
];

// Every station commit message starts with `[station] T<n>:` so the inspection
// and GitQuest can find a particular transmission in the history.
export const TRANSMISSION_PREFIX = '[station] T';
export const T = {
  opened: 0, // shift pack opened, M14 task
  holdNotice: 1, // Maintenance 18:15 hold notice, M15 task
  discrepancy: 2, // discrepancy issue recorded
  released: 3, // Maintenance 22:25 release, Docking 22:40 confirmation
  arrivalProposal: 4, // on REVIEW_BRANCH: arrival line and bay report
  reviewOpened: 5, // review pull request recorded in progress
  correction: 6, // on REVIEW_BRANCH: release time corrected
  corrected: 7, // correction recorded in progress
  finalTask: 8, // final handover task opened
  complete: 9, // stage complete
  repairTask: 10, // only after an early merge of the review pull request
  restore: 12, // a direct push to main undone
  step: 11, // the current step of a mission moved on
};
