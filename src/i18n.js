/**
 * All visible copy lives here. Add a locale by adding a dictionary; the game
 * picks the DSH locale reported by `game.runtime.locale`.
 */

export const DICTIONARIES = {
  zh: {
    title: 'Ember Drift',
    kicker: '两分钟，穿过烬落的漂流',
    score: '分数',
    best: '最高分',
    time: '时间',
    streak: '连收',
    hull: '船体',
    stars: '星光',
    ready: '准备漂流',
    readyNew: '一艘小舟，一片落火的天空，和几颗值得去追的星。',
    readyContinue: '上一次漂流还有余温。',
    readyGoal: '收集星光，避开落火，在烬落中坚持两分钟。',
    continueHint: '空格 — 继续上一次漂流',
    startHint: '空格 — 开始新的漂流',
    newHint: 'N — 从头开始',
    paused: '漂流暂停',
    pausedBody: '余烬会等你。',
    resumeHint: 'P 或「继续」回到漂流',
    completeTitle: '漂流完成',
    lostTitle: '小舟熄灭了',
    completeBody: '两分钟，仍然亮着。',
    lostBody: '落火追上了你。',
    finalScore: '本局得分',
    bestScore: '最高分',
    starsCollected: '收集星光',
    restartHint: '空格 — 再漂一次',
    loading: '正在点亮引擎…',
    errorTitle: '引擎离线',
    readyFailed: 'Runtime 没有回应（{code}）',
    reloadHint: '刷新游戏后再试一次。',
    saveFailed: '保存失败（{code}）',
    saveOk: '已保存',
    scoreRange: '分数超出声明范围（{code}）',
    hintLoading: '正在点亮引擎…',
    hintReadyContinue: '空格继续 · N 新漂流 · P 暂停',
    hintReady: '空格开始 · ← → 漂移 · P 暂停',
    hintPlaying: '← → 或 A D 漂移 · P 暂停 · 收集星光，避开落火',
    hintPaused: 'P 或「继续」回到漂流',
    hintOver: '空格再漂一次',
    hintError: '刷新后重试',
    hintPlayingShort: '← → 漂移 · P 暂停',
    ariaContinue: '检测到未完成的漂流。按空格继续。',
    ariaPaused: '游戏已暂停。',
    ariaOver: '本局结束，得分 {score}。按空格再漂一次。',
    seconds: '{value} 秒',
  },
  en: {
    title: 'Ember Drift',
    kicker: 'A two-minute drift through the emberfall',
    score: 'Score',
    best: 'Best',
    time: 'Time',
    streak: 'Streak',
    hull: 'Hull',
    stars: 'Stars',
    ready: 'Ready to drift',
    readyNew: 'A little skiff, a falling sky, and a handful of stars worth catching.',
    readyContinue: 'Your last drift is still warm.',
    readyGoal: 'Gather stars. Slip past the emberfall. Stay alight for two minutes.',
    continueHint: 'Space — continue your drift',
    startHint: 'Space — begin a new drift',
    newHint: 'N — start fresh',
    paused: 'Drift paused',
    pausedBody: 'The embers will wait.',
    resumeHint: 'P or Resume to continue',
    completeTitle: 'Drift complete',
    lostTitle: 'The skiff went dark',
    completeBody: 'Two minutes, still alight.',
    lostBody: 'The emberfall caught you.',
    finalScore: 'Final score',
    bestScore: 'Best',
    starsCollected: 'Stars gathered',
    restartHint: 'Space — drift again',
    loading: 'Warming the engines…',
    errorTitle: 'Engines offline',
    readyFailed: 'The runtime did not answer ({code})',
    reloadHint: 'Reload the game to try again.',
    saveFailed: 'Could not save ({code})',
    saveOk: 'Checkpoint saved',
    scoreRange: 'Score outside the declared range ({code})',
    hintLoading: 'Warming the engines…',
    hintReadyContinue: 'Space continue · N new drift · P pause',
    hintReady: 'Space start · ← → drift · P pause',
    hintPlaying: '← → or A D drift · P pause · gather stars, dodge the emberfall',
    hintPaused: 'P or Resume to continue',
    hintOver: 'Space — drift again',
    hintError: 'Reload to try again',
    hintPlayingShort: '← → drift · P pause',
    ariaContinue: 'An unfinished drift is available. Press Space to continue.',
    ariaPaused: 'Game paused.',
    ariaOver: 'Run over. Final score {score}. Press Space to drift again.',
    seconds: '{value}s',
  },
};

export function normalizeLocale(locale) {
  return String(locale || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function createI18n(locale) {
  const language = normalizeLocale(locale);
  const dictionary = DICTIONARIES[language];
  function t(key, variables) {
    const template = dictionary[key] === undefined ? String(key) : String(dictionary[key]);
    if (!variables) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      variables[name] === undefined ? match : String(variables[name])
    );
  }
  return { language, locale, t };
}
