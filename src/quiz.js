const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v) => (Array.isArray(v) ? v : []);

export const SUPPORTED_QTYPES = new Set(['multichoice', 'truefalse', 'shortanswer', 'numerical', 'description']);
const ALLOWED_RULES = new Set(['quizaccess_openclosedate', 'quizaccess_numattempts', 'quizaccess_timelimit', 'quizaccess_delaybetweenattempts']);
const STATES = new Set(['inprogress', 'overdue', 'finished', 'abandoned']);

export function parseQuiz(raw) {
  const r = raw || {};
  return {
    id: r.id,
    cmid: r.coursemodule,
    name: r.name || '',
    introHtml: r.intro || '',
    timeOpen: num(r.timeopen),
    timeClose: num(r.timeclose),
    timeLimit: num(r.timelimit),
    attemptsAllowed: num(r.attempts),
    gradeMethod: num(r.grademethod),
    maxGrade: num(r.grade),
    sumGrades: num(r.sumgrades),
    sequential: r.navmethod === 'sequential',
  };
}

export function parseAttempts(raw) {
  return list(raw && raw.attempts)
    .filter((a) => a && !a.preview)
    .map((a) => ({
      id: a.id,
      number: num(a.attempt),
      state: STATES.has(a.state) ? a.state : 'unknown',
      timeStart: num(a.timestart),
      timeFinish: num(a.timefinish),
      sumGrades: a.sumgrades == null ? null : num(a.sumgrades),
      currentPage: num(a.currentpage),
    }))
    .sort((a, b) => a.number - b.number);
}

export function parseBestGrade(raw) {
  const has = Boolean(raw && raw.hasgrade);
  return { has, grade: has && Number.isFinite(Number(raw.grade)) ? Number(raw.grade) : null };
}

export function attemptGrade(attempt, quiz) {
  if (attempt.state !== 'finished' || attempt.sumGrades === null || !quiz.sumGrades) return null;
  return Math.round(((attempt.sumGrades * quiz.maxGrade) / quiz.sumGrades) * 100) / 100;
}

const strings = (v) => list(v).filter((s) => typeof s === 'string' && s.trim() !== '');

// Decides what the quiz screen may offer. Anything uncertain means "do not start".
export function startCheck({ access, qtypes, attemptAccess, attempts }) {
  const base = { canStart: false, attemptId: null, messages: [], unsupportedTypes: [], unsupportedRules: [], preflight: false };
  if (!access || !qtypes || !attemptAccess || !attempts) return { ...base, mode: 'unknown' };
  const unsupportedRules = list(access.activerulenames).filter((n) => !ALLOWED_RULES.has(n));
  const unsupportedTypes = list(qtypes.questiontypes).filter((t) => !SUPPORTED_QTYPES.has(t));
  const preflight = attemptAccess.ispreflightcheckrequired === true;
  if (unsupportedRules.length || unsupportedTypes.length || preflight) {
    return { ...base, mode: 'unsupported', unsupportedRules, unsupportedTypes, preflight };
  }
  if (attempts.some((a) => a.state === 'overdue')) return { ...base, mode: 'overdue' };
  const running = attempts.find((a) => a.state === 'inprogress');
  if (running) return { ...base, mode: 'continue', attemptId: running.id };
  if (access.canattempt !== true) return { ...base, mode: 'blocked', messages: strings(access.preventaccessreasons) };
  const reasons = strings(attemptAccess.preventnewattemptreasons);
  if (reasons.length) return { ...base, mode: 'blocked', messages: reasons };
  return { ...base, mode: 'start', canStart: true };
}

export function formatTimeLeft(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
