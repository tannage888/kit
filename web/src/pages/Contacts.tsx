import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Contact {
  id: string;
  name: string;
  tier: number;
  last_contact: string;
  frequency_days: number;
  frequency: string;
  whatsapp: string;
  wa_capture: string;
  whatsapp_capture: string;
  linkedin_username: string | null;
  linkedin_capture: string;
  instagram_username: string | null;
  instagram_capture: string;
}

function computeNextAction(lastContact: string, frequencyDays: number): string {
  if (!lastContact) return '—';
  const d = new Date(lastContact);
  if (isNaN(d.getTime())) return '—';
  d.setDate(d.getDate() + frequencyDays);
  return d.toISOString().slice(0, 10);
}

function tierLabel(tier: number) {
  if (tier === 1) return 'Inner Circle';
  if (tier === 2) return 'Active';
  return 'Business';
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Contact[]>('/api/contacts')
      .then(setContacts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading contacts…</p>;
  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;

  const sorted = [...contacts].sort((a, b) => {
    const na = computeNextAction(a.last_contact, a.frequency_days);
    const nb = computeNextAction(b.last_contact, b.frequency_days);
    return na.localeCompare(nb);
  });

  return (
    <div>
      <h1>Contacts</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left', color: '#a0a0b0' }}>
            <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Name</th>
            <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Tier</th>
            <th style={{ padding: '0.5rem 1rem 0.5rem 0' }}>Last Contact</th>
            <th style={{ padding: '0.5rem 0' }}>Next Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const next = computeNextAction(c.last_contact, c.frequency_days);
            const overdue = next !== '—' && next < new Date().toISOString().slice(0, 10);
            return (
              <tr
                key={c.id}
                onClick={() => navigate(`/contacts/${c.id}`)}
                style={{
                  borderBottom: '1px solid #222',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1e1e30')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '0.6rem 1rem 0.6rem 0', fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0', color: '#a0a0b0' }}>{tierLabel(c.tier)}</td>
                <td style={{ padding: '0.6rem 1rem 0.6rem 0', color: '#a0a0b0' }}>{c.last_contact || '—'}</td>
                <td style={{ padding: '0.6rem 0', color: overdue ? '#f87171' : '#a0a0b0' }}>{next}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 && <p style={{ color: '#a0a0b0', marginTop: '1rem' }}>No contacts found.</p>}
    </div>
  );
}
