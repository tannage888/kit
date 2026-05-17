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

  useEffect(() => {
    Promise.all([
      api.get<Contact[]>('/api/contacts'),
      api.get<Group[]>('/api/groups').catch(() => [] as Group[]),
    ]).then(([contacts, grps]) => {
      const found = contacts.find((c) => c.id === id);
      if (!found) { setError('Contact not found'); return; }
      setContact(found);
      setGroups(grps);
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
      await api.put(`/api/contacts/${id}`, payload);
      setSaveMsg('Saved');
    } catch (e: unknown) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const selectStyle = { ...inputStyle, width: 'auto' };

  return (
    <div style={{ maxWidth: 560 }}>
      <button
        onClick={() => navigate('/contacts')}
        style={{ color: '#a0a0b0', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '1.25rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 style={{ marginBottom: '1.5rem' }}>{contact.name}</h1>

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
    </div>
  );
}
