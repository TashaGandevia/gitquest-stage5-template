// The repository GitQuest publishes as the template. Station control never
// runs there, even before the "Template repository" setting is ticked.
export const TEMPLATE_REPOSITORY = 'TashaGandevia/gitquest-stage5-template';

export const PROGRESS_PATH = '.gitquest/progress.json';
export const DEPARTURES_PATH = 'docking-log/departures.md';
export const ARRIVALS_PATH = 'docking-log/arrivals.md';
export const FAULTS_PATH = 'docking-log/faults.md';

// Learners only edit the docking log. A pull request touching these fails inspection.
export const PROTECTED_PATHS = ['.github/', 'scripts/', '.gitquest/', '.gitattributes'];

// GitHub commits made in the web editor, or by its merge and "Update branch"
// buttons, use this committer email.
export const WEB_COMMITTER_EMAIL = 'noreply@github.com';

export const LABELS = [
  { name: 'mission', color: '1d76db', description: 'A task from station control' },
  { name: 'fault', color: 'd93f0b', description: 'A fault reported on a docked ship' },
];

// Every station commit message starts with this, followed by its transmission
// number, so inspection can find "the transmission you need to have pulled".
export const TRANSMISSION_PREFIX = '[station] T';
