// Fixed option lists shared by validation and the client (served by GET /api/meta).

export const REGIONS = [
  'Greater Accra', 'Ashanti', 'Central', 'Eastern', 'Western', 'Western North', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East', 'Upper West', 'Bono', 'Bono East', 'Ahafo',
];

export const DENOMINATIONS = [
  'Catholic', 'Methodist', 'Presbyterian', 'Anglican', 'Baptist', 'Pentecostal', 'Charismatic',
  'Church of Pentecost', 'Assemblies of God', 'Seventh-day Adventist', 'Lutheran', 'Evangelical',
  'Non-denominational', 'Other',
];

export const OPTIONS = {
  gender: ['man', 'woman'],
  church_attendance: ['several_weekly', 'weekly', 'monthly', 'occasionally'],
  wants_children: ['yes', 'no', 'open'],
  marriage_timeline: ['within_1_year', '1_2_years', '2_plus_years'],
  drinks: ['never', 'occasionally'],
  relationship_status: ['never_married', 'divorced', 'widowed', 'annulled'],
};

export const REPORT_REASONS = {
  scam: 'Asking for money or a scam',
  fake: 'Fake profile or photos',
  married: 'Married or in a relationship',
  harassment: 'Harassment or pressure',
  inappropriate: 'Sexual or inappropriate content',
  underage: 'May be under 18',
  other: 'Something else',
};

// Courtship journey. Moving forward needs both members to agree.
export const STAGES = [
  { id: 'getting_to_know', label: 'Getting to know each other' },
  { id: 'courtship', label: 'Intentional courtship' },
  { id: 'family_introduction', label: 'Meeting families' },
  { id: 'engaged', label: 'Engaged' },
];
