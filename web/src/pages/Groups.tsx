import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Group {
  jid: string;
  name: string;
  participants: string[];
}

interface Contact {
  id: string;
  name: string;
  whatsapp_groups: string | null;
}

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Group[]>('/api/groups').catch(() => [] as Group[]),
      api.get<Contact[]>('/api/contacts'),
    ]).then(([grps, cts]) => {
      setGroups(grps);
      setContacts(cts);
      setLoading(false);
    }).catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;
  if (error) return <div className="alert alert-error">{error}</div>;

  function assignedContacts(jid: string): Contact[] {
    return contacts.filter((c) =>
      c.whatsapp_groups?.split(',').map((j) => j.trim()).includes(jid)
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>WhatsApp Groups</h1>
      </div>

      {groups.length === 0 && (
        <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
          No groups found. Ensure the WhatsApp daemon is running and connected.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {groups.map((g) => {
          const tracked = assignedContacts(g.jid);
          return (
            <div
              key={g.jid}
              style={{
                background: '#13132a',
                border: '1px solid #1e1e35',
                borderRadius: 8,
                padding: '0.9rem 1.1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 600, color: '#e0e0e0', fontSize: '0.95rem' }}>{g.name}</span>
                <span style={{ color: '#555', fontSize: '0.78rem' }}>{g.participants.length} members</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: tracked.length > 0 ? '0.5rem' : 0 }}>
                {g.jid}
              </div>
              {tracked.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {tracked.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/contacts/${c.id}`)}
                      style={{
                        background: 'rgba(124,111,205,0.15)',
                        border: '1px solid rgba(124,111,205,0.4)',
                        borderRadius: 4,
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.8rem',
                        color: '#a78bfa',
                        cursor: 'pointer',
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#3a3a55', fontStyle: 'italic' }}>
                  No contacts assigned
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
