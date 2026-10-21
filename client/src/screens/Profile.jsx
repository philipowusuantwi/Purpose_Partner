import { useState } from 'react';
import { api, imageToDataUrl } from '../api.js';
import { useAction, useApi } from '../hooks.js';
import { Choice, ErrorNote, Field, Screen } from '../components/ui.jsx';

const DEFAULTS = {
  first_name: '', gender: '', birth_date: '', country: 'Ghana', region: '', city: '', denomination: '', church_attendance: 'weekly',
  faith_statement: '', about: '', occupation: '', education: '', has_children: false, wants_children: 'open',
  marriage_timeline: '1_2_years', open_to_relocate: false, drinks: 'never', seeking_age_min: 22, seeking_age_max: 55, same_denomination: false,
};

/** Profile fields. In onboarding it runs as three steps; when editing, everything shows at once. */
function ProfileFields({ v, set, meta, step, editing }) {
  const show = (n) => editing || step === n;
  return (
    <>
      {show(0) && (
        <>
          <Field label="First name" hint="Only your first name is shown to others."><input type="text" maxLength={40} required value={v.first_name} onChange={(e) => set('first_name', e.target.value)} /></Field>
          {!editing && (
            <>
              <Field label="I am a" group>
                <div className="chips">{meta.options.gender.map((g) => <button key={g} type="button" className={`chip ${v.gender === g ? 'active' : ''}`} aria-pressed={v.gender === g} onClick={() => set('gender', g)}>{g === 'man' ? 'Man' : 'Woman'}</button>)}</div>
              </Field>
              <Field label="Date of birth" hint="Others see your age, not your birthday. This must match your Ghana Card."><input type="date" required value={v.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></Field>
            </>
          )}
          <div className="two">
            <Field label="Country"><input type="text" value={v.country} onChange={(e) => set('country', e.target.value)} /></Field>
            <Field label="Region">
              {v.country === 'Ghana' ? <Choice field="region" value={v.region} options={meta.regions} onChange={(x) => set('region', x)} placeholder="Choose…" /> : <input type="text" value={v.region ?? ''} onChange={(e) => set('region', e.target.value)} />}
            </Field>
          </div>
          <Field label="City or town"><input type="text" required value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <div className="two">
            <Field label="Occupation"><input type="text" maxLength={80} value={v.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)} /></Field>
            <Field label="Education"><input type="text" maxLength={80} value={v.education ?? ''} onChange={(e) => set('education', e.target.value)} /></Field>
          </div>
        </>
      )}
      {show(1) && (
        <>
          <Field label="Denomination"><Choice field="denomination" value={v.denomination} options={meta.denominations} onChange={(x) => set('denomination', x)} placeholder="Choose…" /></Field>
          <Field label="I attend church"><Choice field="church_attendance" value={v.church_attendance} options={meta.options.church_attendance} onChange={(x) => set('church_attendance', x)} /></Field>
          <Field label="My walk with God" hint="A sentence or two about your faith."><textarea maxLength={400} value={v.faith_statement ?? ''} onChange={(e) => set('faith_statement', e.target.value)} /></Field>
          <Field label="About me"><textarea maxLength={1000} value={v.about ?? ''} onChange={(e) => set('about', e.target.value)} /></Field>
        </>
      )}
      {show(2) && (
        <>
          <Field label="Children"><Choice field="wants_children" value={v.wants_children} options={meta.options.wants_children} onChange={(x) => set('wants_children', x)} /></Field>
          <label className="check"><input type="checkbox" checked={Boolean(v.has_children)} onChange={(e) => set('has_children', e.target.checked)} /> I already have children</label>
          <Field label="I hope to marry"><Choice field="marriage_timeline" value={v.marriage_timeline} options={meta.options.marriage_timeline} onChange={(x) => set('marriage_timeline', x)} /></Field>
          <Field label="Alcohol"><Choice field="drinks" value={v.drinks} options={meta.options.drinks} onChange={(x) => set('drinks', x)} /></Field>
          <label className="check"><input type="checkbox" checked={Boolean(v.open_to_relocate)} onChange={(e) => set('open_to_relocate', e.target.checked)} /> I am open to relocating for marriage</label>
          <fieldset>
            <legend>Who I would like to meet</legend>
            <div className="two">
              <Field label="Age from"><input type="number" min={18} max={99} value={v.seeking_age_min} onChange={(e) => set('seeking_age_min', Number(e.target.value))} /></Field>
              <Field label="to"><input type="number" min={18} max={99} value={v.seeking_age_max} onChange={(e) => set('seeking_age_max', Number(e.target.value))} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={Boolean(v.same_denomination)} onChange={(e) => set('same_denomination', e.target.checked)} /> Only show people from my denomination</label>
          </fieldset>
        </>
      )}
    </>
  );
}

export function Onboarding({ meta, onDone }) {
  const [v, setV] = useState(DEFAULTS);
  const [step, setStep] = useState(0);
  const { busy, error, run, setError } = useAction();
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const titles = ['About you', 'Your faith', 'Marriage & family'];
  const next = (e) => {
    e.preventDefault();
    setError(null);
    if (step === 0 && (!v.gender || !v.birth_date)) return setError(new Error('Please choose man or woman and enter your date of birth.'));
    if (step === 1 && !v.denomination) return setError(new Error('Please choose your denomination.'));
    if (step < 2) return setStep(step + 1);
    return run(async () => onDone(await api('/profile', { method: 'PUT', body: v })));
  };
  return (
    <div style={{ paddingTop: 16 }}>
      <div className="progress-steps">{titles.map((t, i) => <span key={t} className={i <= step ? 'on' : ''} />)}</div>
      <h1>{titles[step]}</h1>
      <form className="card" onSubmit={next}>
        <ProfileFields v={v} set={set} meta={meta} step={step} />
        <ErrorNote error={error} />
        <div className="row">
          {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn grow" disabled={busy}>{step < 2 ? 'Continue' : 'Create my profile'}</button>
        </div>
      </form>
    </div>
  );
}

export function EditProfile({ me, meta, onSaved, notify }) {
  const [v, setV] = useState(() => {
    const p = { ...me.profile };
    for (const k of ['has_children', 'open_to_relocate', 'same_denomination']) p[k] = Boolean(p[k]);
    return p;
  });
  const photos = useApi('/profile/photos');
  const { busy, error, run } = useAction();
  const upload = useAction();
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));

  const save = (e) => {
    e.preventDefault();
    const { user_id: _u, gender: _g, birth_date: _b, visible: _v, hidden_reason: _h, updated_at: _t, ...body } = v;
    run(async () => { onSaved(await api('/profile', { method: 'PUT', body })); notify('Profile saved'); });
  };
  const addPhoto = (file) => upload.run(async () => {
    const data = await imageToDataUrl(file);
    await api('/uploads/photo', { method: 'POST', body: { data } });
    photos.reload();
    notify('Photo uploaded. It will appear once a moderator approves it.');
  });

  return (
    <Screen title="My profile" backTo="/me" right={<a className="btn sm secondary" href={`#/members/${me.user.id}`}>Preview</a>}>
      <section className="card">
        <h2>Photos</h2>
        <p className="small muted">Clear, recent photos of you alone. Each photo is reviewed before others can see it.</p>
        <div className="thumbs">
          {photos.data?.photos.map((p) => (
            <div key={p.id} className="thumb">
              <img src={p.data} alt="" />
              <span className={`tag ${p.status === 'approved' ? '' : p.status === 'pending' ? 'gold' : 'rose'}`}>{p.status}</span>
              <button type="button" className="icon-btn" aria-label="Remove photo" style={{ width: 32, height: 32 }} onClick={() => api(`/profile/photos/${p.id}`, { method: 'DELETE' }).then(photos.reload)}>×</button>
            </div>
          ))}
        </div>
        <label className="btn secondary block" style={{ marginTop: 12 }}>
          {upload.busy ? 'Uploading…' : 'Add a photo'}
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && addPhoto(e.target.files[0])} />
        </label>
        <ErrorNote error={upload.error} />
      </section>
      <form className="card" onSubmit={save}>
        <ProfileFields v={v} set={set} meta={meta} editing />
        <ErrorNote error={error} />
        <button className="btn block" disabled={busy}>Save changes</button>
      </form>
    </Screen>
  );
}
