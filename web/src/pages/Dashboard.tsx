import { useEffect, useState } from 'react';
import { api } from '../api/client';

type EnergyLevel = 'high' | 'medium' | 'low';

interface Contact {
  id: string;
  name: string;
  tier: number;
  last_contact: string;
  frequency_days: number;
  active: boolean;
}

const ENERGY_COLORS: Record<EnergyLevel, string> = {
  high: '#4ade80',
  medium: '#facc15',
  low: '#f87171',
};

function computeNextAction(lastContact: string, frequencyDays: number): string {
  if (!lastContact) return '';
  const d = new Date(lastContact);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + frequencyDays);
  return d.toISOString().slice(0, 10);
}

function tierLabel(tier: number) {
  if (tier === 1) return 'Inner Circle';
  if (tier === 2) return 'Active';
  return 'Business';
}

export default function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);

  const [energy, setEnergy] = useState<EnergyLevel | null>(null);
  const [energyLoading, setEnergyLoading] = useState(true);
  const [settingEnergy, setSettingEnergy] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ level: EnergyLevel | null }>('/api/energy')
      .then((d) => setEnergy(d.level))
      .finally(() => setEnergyLoading(false));

    api.get<Contact[]>('/api/contacts')
      .then(setContacts)
      .catch((e) => setContactsError(e.message))
      .finally(() => setContactsLoading(false));
  }, []);

  async function handleSetEnergy(level: EnergyLevel) {
    setSettingEnergy(true);
    try {
      await api.post<{ ok: boolean; level: EnergyLevel }>('/api/energy', { level });
      setEnergy(level);
    } finally {
      setSettingEnergy(false);
    }
  }

  const todaysContacts = contacts
    .filter((c) => {
      if (c.active === false) return false;
      const next = computeNextAction(c.last_contact, c.frequency_days);
      return next && next <= today;
    })
    .sort((a, b) => {
      const na = computeNextAction(a.last_contact, a.frequency_days);
      const nb = computeNextAction(b.last_contact, b.frequency_days);
      return na.localeCompare(nb);
    });

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Dashboard</h1>

      {/* Energy widget */}
      <section style={{ marginBottom: '2rem', padding: '1.25rem', background: '#16162a', borderRadius: 8 }}>
        <h2 style={{ fontSize: '1rem', color: '#a0a0b0', marginBottom: '0.75rem', fontWeight: 500 }}>
          Social Energy — {today}
        </h2>
        {energyLoading ? (
          <p style={{ color: '#a0a0b0' }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: energy ? ENERGY_COLORS[energy] : '#555',
            }}>
              {energy ? energy.charAt(0).toUpperCase() + energy.slice(1) : 'Not set'}
            </span>
            {(['high', 'medium', 'low'] as EnergyLevel[]).map((lvl) => (
              <button
                key={lvl}
                disabled={settingEnergy || energy === lvl}
                onClick={() => handleSetEnergy(lvl)}
                style={{
                  padding: '0.3rem 0.9rem',
                  borderRadius: 4,
                  border: '1px solid',
                  borderColor: energy === lvl ? ENERGY_COLORS[lvl] : '#333',
                  background: energy === lvl ? ENERGY_COLORS[lvl] + '22' : 'transparent',
                  color: ENERGY_COLORS[lvl],
                  cursor: energy === lvl ? 'default' : 'pointer',
                  opacity: settingEnergy ? 0.6 : 1,
                  fontWeight: 500,
                  fontSize: '0.85rem',
                }}
              >
                {lvl}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Today's contacts */}
      <section>
        <h2 style={{ fontSize: '1rem', color: '#a0a0b0', marginBottom: '0.75rem', fontWeight: 500 }}>
          Due Today ({contactsLoading ? '…' : todaysContacts.length})
        </h2>
        {contactsError && <p style={{ color: '#f87171' }}>Error: {contactsError}</p>}
        {!contactsLoading && !contactsError && todaysContacts.length === 0 && (
          <p style={{ color: '#a0a0b0' }}>No contacts due today.</p>
        )}
        {todaysContacts.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333', textAlign: 'left', color: '#a0a0b0', fontSize: '0.85rem' }}>
                <th style={{ padding: '0.4rem 1rem 0.4rem 0' }}>Name</th>
                <th style={{ padding: '0.4rem 1rem 0.4rem 0' }}>Tier</th>
                <th style={{ padding: '0.4rem 0' }}>Due</th>
              </tr>
            </thead>
            <tbody>
              {todaysContacts.map((c) => {
                const next = computeNextAction(c.last_contact, c.frequency_days);
                const overdue = next < today;
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1a1a2e' }}>
                    <td style={{ padding: '0.55rem 1rem 0.55rem 0', fontWeight: 500 }}>{c.name}</td>
                    <td style={{ padding: '0.55rem 1rem 0.55rem 0', color: '#a0a0b0' }}>{tierLabel(c.tier)}</td>
                    <td style={{ padding: '0.55rem 0', color: overdue ? '#f87171' : '#4ade80' }}>
                      {overdue ? `Overdue (${next})` : 'Today'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
