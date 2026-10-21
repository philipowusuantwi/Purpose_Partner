// PurposeMatch engine: faith, values, compatibility, location and readiness weighting.
//
//   Faith 30 · Values 25 · Compatibility 20 · Location 15 · Readiness 10  (= 100)
//
// Hard filters (both directions): opposite gender, each within the other's age range, and
// the "same denomination only" preference. Blocked, hidden, paused and suspended members are
// never suggested.

const ATTENDANCE = ['occasionally', 'monthly', 'weekly', 'several_weekly'];
const TIMELINE = ['within_1_year', '1_2_years', '2_plus_years'];

export function ageOn(birthDate, now = new Date()) {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

const similarity = (a, b) => 1 - Math.abs(a - b) / 100; // 0..1 for two 0-100 scores

/**
 * @param me, them  profile rows with `age` and optional `readiness` scores ({overall, dimensions})
 * @returns {score, breakdown, reasons}
 */
export function compatibility(me, them) {
  const reasons = [];

  // Faith (30)
  let faith = 0;
  if (me.denomination === them.denomination) { faith += 12; reasons.push(`Both ${me.denomination}`); } else faith += 5;
  const attDiff = Math.abs(ATTENDANCE.indexOf(me.church_attendance) - ATTENDANCE.indexOf(them.church_attendance));
  faith += Math.max(0, 10 - 4 * attDiff);
  if (attDiff === 0) reasons.push('Same commitment to church attendance');
  if (me.readiness && them.readiness) {
    faith += Math.round(8 * similarity(me.readiness.dimensions.faith, them.readiness.dimensions.faith));
  } else faith += 4;

  // Values (25)
  let values = 0;
  if (me.wants_children === them.wants_children) { values += 10; reasons.push('Same hopes for children'); } else if (me.wants_children === 'open' || them.wants_children === 'open') values += 6;
  const tDiff = Math.abs(TIMELINE.indexOf(me.marriage_timeline) - TIMELINE.indexOf(them.marriage_timeline));
  values += [10, 4, 0][tDiff];
  if (tDiff === 0) reasons.push('Similar marriage timeline');
  values += me.drinks === them.drinks ? 5 : 1;

  // Compatibility (20)
  let compat = 10;
  if (me.readiness && them.readiness) {
    const d1 = me.readiness.dimensions;
    const d2 = them.readiness.dimensions;
    const traits = ['agreeableness', 'conscientiousness', 'emotional_stability'];
    const traitSim = traits.reduce((s, t) => s + similarity(d1[t], d2[t]), 0) / traits.length;
    const skills = (d1.communication + d1.conflict + d2.communication + d2.conflict) / 400;
    compat = Math.round(12 * traitSim + 8 * skills);
    if (traitSim > 0.85) reasons.push('Similar temperament');
  }

  // Location (15)
  let location;
  if (me.country === them.country && me.city && me.city.toLowerCase() === them.city?.toLowerCase()) { location = 15; reasons.push(`Both in ${them.city}`); } else if (me.country === them.country && me.region && me.region === them.region) { location = 11; reasons.push(`Both in ${them.region}`); } else if (me.country === them.country) location = 7;
  else location = me.open_to_relocate || them.open_to_relocate ? 6 : 2;

  // Readiness (10)
  const readiness = me.readiness && them.readiness
    ? Math.round((me.readiness.overall + them.readiness.overall) / 20)
    : 4;

  const breakdown = { faith, values, compatibility: compat, location, readiness };
  const score = Math.min(100, faith + values + compat + location + readiness);
  return { score, breakdown, reasons: reasons.slice(0, 4) };
}

/** Whether two profiles pass each other's hard filters. */
export function eligible(me, them) {
  if (me.gender === them.gender) return false;
  if (them.age < me.seeking_age_min || them.age > me.seeking_age_max) return false;
  if (me.age < them.seeking_age_min || me.age > them.seeking_age_max) return false;
  if ((me.same_denomination || them.same_denomination) && me.denomination !== them.denomination) return false;
  return true;
}
