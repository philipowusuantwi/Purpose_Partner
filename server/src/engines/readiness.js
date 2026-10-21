// Character & Relationship Readiness assessment. Results are educational reflections for
// personal growth, not psychological or clinical assessments.
//
// Every item is answered 1 (strongly disagree) - 5 (strongly agree). `r: true` items are
// reverse-scored.

export const QUESTIONS = [
  // Big Five (short form, two items per trait)
  { id: 'o1', dim: 'openness', text: 'I enjoy new ideas, places and experiences.' },
  { id: 'o2', dim: 'openness', text: 'I prefer to stick with what I already know.', r: true },
  { id: 'c1', dim: 'conscientiousness', text: 'I keep my commitments and finish what I start.' },
  { id: 'c2', dim: 'conscientiousness', text: 'I am often disorganised or late.', r: true },
  { id: 'e1', dim: 'extraversion', text: 'I feel energised by being around people.' },
  { id: 'e2', dim: 'extraversion', text: 'I am usually quiet in a group.', r: true },
  { id: 'a1', dim: 'agreeableness', text: 'I am patient and kind, even when others are difficult.' },
  { id: 'a2', dim: 'agreeableness', text: 'I can be critical or harsh with people.', r: true },
  { id: 'n1', dim: 'emotional_stability', text: 'I stay calm under pressure.' },
  { id: 'n2', dim: 'emotional_stability', text: 'I worry a lot or get upset easily.', r: true },
  // Attachment
  { id: 'ax1', dim: 'attachment_anxiety', text: 'I often worry that someone I love will leave me.' },
  { id: 'ax2', dim: 'attachment_anxiety', text: 'I need a lot of reassurance that I am loved.' },
  { id: 'av1', dim: 'attachment_avoidance', text: 'I find it hard to depend on someone close to me.' },
  { id: 'av2', dim: 'attachment_avoidance', text: 'I pull away when a relationship gets very close.' },
  // Skills and readiness
  { id: 'cm1', dim: 'communication', text: 'I can share my feelings honestly and calmly.' },
  { id: 'cm2', dim: 'communication', text: 'I listen to understand, not just to reply.' },
  { id: 'cm3', dim: 'communication', text: 'I tend to go silent rather than talk about problems.', r: true },
  { id: 'cf1', dim: 'conflict', text: 'In a disagreement, I look for a solution that works for both of us.' },
  { id: 'cf2', dim: 'conflict', text: 'I can apologise and forgive quickly.' },
  { id: 'cf3', dim: 'conflict', text: 'When I am angry I say things I regret.', r: true },
  { id: 'f1', dim: 'financial', text: 'I live on a budget and save regularly.' },
  { id: 'f2', dim: 'financial', text: 'I am comfortable discussing money openly with a future spouse.' },
  { id: 'f3', dim: 'financial', text: 'I have debts or spending habits that worry me.', r: true },
  { id: 'fm1', dim: 'faith', text: 'Prayer and Bible reading are a regular part of my life.' },
  { id: 'fm2', dim: 'faith', text: 'I am actively involved in my church community.' },
  { id: 'fm3', dim: 'faith', text: 'My faith guides my decisions about relationships.' },
  { id: 'fm4', dim: 'faith', text: 'I have someone who mentors or disciples me.' },
];

const LABELS = {
  openness: 'Openness',
  conscientiousness: 'Conscientiousness',
  extraversion: 'Extraversion',
  agreeableness: 'Agreeableness',
  emotional_stability: 'Emotional steadiness',
  communication: 'Communication',
  conflict: 'Handling conflict',
  financial: 'Financial readiness',
  faith: 'Faith maturity',
};

const GROWTH = {
  emotional_stability: 'Notice what triggers worry or frustration and bring it to God and a trusted friend (Philippians 4:6-7).',
  communication: 'Practise naming feelings with "I feel… when… because…" and asking questions before giving answers (James 1:19).',
  conflict: 'Agree in advance how you will pause and return to a disagreement; forgiveness is a decision, not a feeling (Ephesians 4:26-32).',
  financial: 'Write a simple monthly budget and an honest list of debts; openness about money builds trust before marriage.',
  faith: 'Build a steady rhythm of prayer and Scripture, and ask a mature believer to walk with you through courtship.',
  conscientiousness: 'Small, kept promises build trust. Choose one commitment this week and keep it carefully.',
  agreeableness: 'Practise gentleness: before responding to someone difficult, ask what they might need (Colossians 3:12).',
};

const ATTACHMENT = {
  secure: 'You are generally comfortable with closeness and with independence. Keep nurturing honest, steady communication.',
  anxious: 'You may seek a lot of reassurance. Growing confidence in God\'s love, and saying what you need clearly, can bring peace to relationships.',
  avoidant: 'You may protect yourself by keeping distance. Taking small, safe steps towards openness can deepen trust.',
  fearful: 'You may want closeness but fear it. Consider talking this through with a pastor or Christian counsellor; healing here is very possible.',
};

const toPct = (avg) => Math.round(((avg - 1) / 4) * 100);

/** Validates answers; returns {scores} or {errors}. */
export function scoreReadiness(answers) {
  if (!answers || typeof answers !== 'object') return { errors: ['Please answer every question.'] };
  const sums = {};
  for (const q of QUESTIONS) {
    const v = Number(answers[q.id]);
    if (!Number.isInteger(v) || v < 1 || v > 5) return { errors: ['Please answer every question.'] };
    (sums[q.dim] ??= []).push(q.r ? 6 - v : v);
  }
  const dims = Object.fromEntries(Object.entries(sums).map(([d, arr]) => [d, toPct(arr.reduce((a, b) => a + b, 0) / arr.length)]));

  const anxious = dims.attachment_anxiety >= 50;
  const avoidant = dims.attachment_avoidance >= 50;
  const attachment = anxious && avoidant ? 'fearful' : anxious ? 'anxious' : avoidant ? 'avoidant' : 'secure';

  const readinessDims = ['communication', 'conflict', 'financial', 'faith', 'emotional_stability'];
  const overall = Math.round(readinessDims.reduce((s, d) => s + dims[d], 0) / readinessDims.length);

  const ranked = Object.keys(LABELS).filter((d) => d in dims).sort((a, b) => dims[b] - dims[a]);
  const strengths = ranked.slice(0, 3).map((d) => LABELS[d]);
  const growth = ranked.filter((d) => GROWTH[d] && dims[d] < 60).slice(-3).reverse()
    .map((d) => ({ area: LABELS[d], tip: GROWTH[d] }));

  return {
    scores: {
      overall,
      dimensions: dims,
      attachment,
      attachmentNote: ATTACHMENT[attachment],
      strengths,
      growth,
    },
  };
}

export const DIMENSION_LABELS = LABELS;
export const DISCLAIMER = 'This reflection is for personal growth and conversation. It is not a psychological, clinical or diagnostic assessment.';
