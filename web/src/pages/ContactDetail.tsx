import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Contact {
  id: string;
  name: string;
  tier: number;
  frequency: string;
  frequency_days: number;
  last_contact: string;
  whatsapp: string;
  wa_capture: string;
  whatsapp_capture: string;
  linkedin_username: string | null;
  linkedin_capture: string;
  instagram_username: string | null;
  instagram_capture: string;
  origin_story: string | null;
  special_interests: string | null;
  sensitive_topics: string | null;
  notes: string | null;
  url: string | null;
  active: boolean;
}

interface Interaction {
  id: string;
  date: string;
  notes: string;
  channel: string | null;
}

interface FollowUp {
  id: string;
  text: string;
  completed: boolean;
}

interface ContactFull {
  contact: Contact;
  interactions: Interaction[];
  followUps: FollowUp[];
}

interface Group {
  jid: string;
  name: string;
  participants: string[];
}

interface FormState {
  tier: number;
  frequency: string;
  whatsapp: string;
  whatsapp_capture: string;
  wa_capture: string;
  last_contact: string;
  linkedin_username: string;
  linkedin_capture: string;
  instagram_username: string;
  instagram_capture: string;
  selectedGroups: string[];
  active: boolean;
}

const inputStyle: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e0e0e0',
  padding: '0.4rem 0.6rem',
  fontSize: '0.9rem',
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: '#a0a0b0',
  fontSize: '0.8rem',
  marginBottom: '0.25rem',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'profile' | 'history'>('profile');
  const [history, setHistory] = useState<{ interactions: Interaction[]; followUps: FollowUp[] } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ContactFull>(`/api/contacts/${id}`),
      api.get<Group[]>('/api/groups').catch(() => [] as Group[]),
    ]).then(([full, grps]) => {
      const found = full.contact;
      if (!found) { setError('Contact not found'); return; }
      setContact(found);
      setGroups(grps);
      setHistory({ interactions: full.interactions, followUps: full.followUps });
      setForm({
        tier: found.tier,
        frequency: found.frequency,
        whatsapp: found.whatsapp ?? '',
        whatsapp_capture: found.whatsapp_capture ?? 'disabled',
        wa_capture: found.wa_capture ?? 'on_demand',
        last_contact: found.last_contact ?? '',
        linkedin_username: found.linkedin_username ?? '',
        linkedin_capture: found.linkedin_capture ?? 'disabled',
        instagram_username: found.instagram_username ?? '',
        instagram_capture: found.instagram_capture ?? 'disabled',
        selectedGroups: [],
        active: found.active ?? true,
      });
    }).catch((e) => setError(e.message));
  }, [id]);

  if (error) return (
    <div>
      <button onClick={() => navigate('/contacts')} style={{ color: '#a0a0b0', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '1rem' }}>← Back</button>
      <p style={{ color: '#f87171' }}>{error}</p>
    </div>
  );
  if (!form || !contact) return <p>Loading…</p>;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: value } : f);
    setSaveMsg(null);
  }

  function toggleGroup(jid: string) {
    setForm((f) => {
      if (!f) return f;
      const has = f.selectedGroups.includes(jid);
      return { ...f, selectedGroups: has ? f.selectedGroups.filter((g) => g !== jid) : [...f.selectedGroups, jid] };
    });
    setSaveMsg(null);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, unknown> = {
        tier: form.tier,
        frequency: form.frequency,
        whatsapp: form.whatsapp || undefined,
        whatsapp_capture: form.whatsapp_capture,
        wa_capture: form.wa_capture,
        last_contact: form.last_contact || undefined,
        linkedin_username: form.linkedin_username || undefined,
        linkedin_capture: form.linkedin_capture,
        instagram_username: form.instagram_username || undefined,
        instagram_capture: form.instagram_capture,
      };
      if (form.selectedGroups.length > 0) {
        payload.whatsapp_groups = form.selectedGroups.join(',');
      }
      payload.active = form.active;
      await api.put(`/api/contacts/${id}`, payload);
      setSaveMsg('Saved');
    } catch (e: unknown) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const selectStyle = { ...inputStyle, width: 'auto' };

  const tabBtn = (t: 'profile' | 'history'): React.CSSProperties => ({
    background: tab === t ? '#7c6fcd' : 'transparent',
    border: 'none', cursor: 'pointer', fontSize: '0.9rem',
    padding: '0.4rem 0.9rem', borderRadius: 6, marginRight: '0.25rem',
    color: tab === t ? '#fff' : '#666',
  });

  return (
    <div style={{ maxWidth: 560 }}>
      <button
        onClick={() => navigate('/contacts')}
        style={{ color: '#a0a0b0', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '1.25rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 style={{ marginBottom: '1rem', color: '#e0e0e0' }}>{contact.name}</h1>

      <div style={{ marginBottom: '1.5rem' }}>
        <button style={tabBtn('profile')} onClick={() => setTab('profile')}>Profile</button>
        <button style={tabBtn('history')} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'history' && history && (
        <div>
          {history.followUps.filter(f => !f.completed).length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#a0a0b0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Open Follow-ups</h3>
              {history.followUps.filter(f => !f.completed).map(fu => (
                <div key={fu.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem', color: '#e0e0e0', fontSize: '0.9rem' }}>
                  <span style={{ color: '#7c6fcd', marginTop: 2 }}>□</span>
                  <span>{fu.text}</span>
                </div>
              ))}
            </div>
          )}

          {contact.origin_story && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#a0a0b0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Background</h3>
              <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.5 }}>{contact.origin_story}</p>
            </div>
          )}

          {contact.special_interests && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#a0a0b0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Interests</h3>
              <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.5 }}>{contact.special_interests}</p>
            </div>
          )}

          {contact.sensitive_topics && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#a0a0b0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Sensitive Topics</h3>
              <p style={{ color: '#f87171', fontSize: '0.9rem', lineHeight: 1.5 }}>{contact.sensitive_topics}</p>
            </div>
          )}

          {contact.notes && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#a0a0b0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Notes</h3>
              <p style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.5 }}>{contact.notes}</p>
            </div>
          )}

          {history.interactions.length > 0 && (
            <div>
              <h3 style={{ color: '#a0a0b0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Interaction Log</h3>
              {history.interactions.map(interaction => (
                <div key={interaction.id} style={{ borderLeft: '2px solid #333', paddingLeft: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#a0a0b0', fontSize: '0.8rem' }}>{interaction.date}</span>
                    {interaction.channel && (
                      <span style={{ background: '#1e1e35', border: '1px solid #333', borderRadius: 4, padding: '0.1rem 0.4rem', fontSize: '0.72rem', color: '#7c6fcd' }}>
                        {interaction.channel}
                      </span>
                    )}
                  </div>
                  <p style={{ color: '#ccc', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 }}>{interaction.notes}</p>
                </div>
              ))}
            </div>
          )}

          {history.interactions.length === 0 && !contact.origin_story && !contact.notes && (
            <p style={{ color: '#555', fontSize: '0.9rem' }}>No history recorded yet.</p>
          )}
        </div>
      )}

      {tab === 'profile' && (<>

      <Field label="Tier">
        <select style={selectStyle} value={form.tier} onChange={(e) => set('tier', Number(e.target.value))}>
          <option value={1}>1 — Inner Circle</option>
          <option value={2}>2 — Active</option>
          <option value={3}>3 — Business Contact</option>
        </select>
      </Field>

      <Field label="Frequency">
        <select style={selectStyle} value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
          <option>Weekly</option>
          <option>Monthly</option>
          <option>Quarterly</option>
        </select>
      </Field>

      <Field label="WhatsApp number (E.164)">
        <input style={inputStyle} value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="+447700900123" />
      </Field>

      <Field label="WhatsApp capture">
        <select style={selectStyle} value={form.whatsapp_capture} onChange={(e) => set('whatsapp_capture', e.target.value)}>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </Field>

      <Field label="Capture mode">
        <select style={selectStyle} value={form.wa_capture} onChange={(e) => set('wa_capture', e.target.value)}>
          <option value="auto">Auto</option>
          <option value="on_demand">On demand</option>
          <option value="off">Off</option>
        </select>
      </Field>

      <Field label="Last contact (YYYY-MM-DD)">
        <input style={inputStyle} type="date" value={form.last_contact} onChange={(e) => set('last_contact', e.target.value)} />
      </Field>

      <Field label="LinkedIn username">
        <input style={inputStyle} value={form.linkedin_username} onChange={(e) => set('linkedin_username', e.target.value)} />
      </Field>

      <Field label="LinkedIn capture">
        <select style={selectStyle} value={form.linkedin_capture} onChange={(e) => set('linkedin_capture', e.target.value)}>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </Field>

      <Field label="Instagram username">
        <input style={inputStyle} value={form.instagram_username} onChange={(e) => set('instagram_username', e.target.value)} />
      </Field>

      <Field label="Instagram capture">
        <select style={selectStyle} value={form.instagram_capture} onChange={(e) => set('instagram_capture', e.target.value)}>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </Field>

      {groups.length > 0 && (
        <Field label="WhatsApp groups">
          <div style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 4, padding: '0.5rem', maxHeight: 180, overflowY: 'auto' }}>
            {groups.map((g) => (
              <label key={g.jid} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', cursor: 'pointer', color: '#e0e0e0', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={form.selectedGroups.includes(g.jid)}
                  onChange={() => toggleGroup(g.jid)}
                  style={{ accentColor: '#7c6fcd' }}
                />
                {g.name}
                <span style={{ color: '#555', fontSize: '0.75rem' }}>({g.participants.length} members)</span>
              </label>
            ))}
          </div>
          {form.selectedGroups.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: '#a0a0b0', marginTop: '0.25rem' }}>
              {form.selectedGroups.length} group{form.selectedGroups.length > 1 ? 's' : ''} selected — will overwrite existing assignment on save
            </p>
          )}
        </Field>
      )}

      <Field label="Status">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', color: '#e0e0e0', fontSize: '0.9rem' }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            style={{ accentColor: '#7c6fcd', width: 16, height: 16 }}
          />
          Active {!form.active && <span style={{ color: '#f87171', fontSize: '0.8rem' }}>(inactive — hidden from check-ins and sweep)</span>}
        </label>
      </Field>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: '#7c6fcd',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.55rem 1.4rem',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: '0.9rem', color: saveMsg.startsWith('Error') ? '#f87171' : '#4ade80' }}>
            {saveMsg}
          </span>
        )}
      </div>
      </>)}
    </div>
  );
}
