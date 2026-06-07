import { useEffect, useState } from 'react';
import { useNavigate, useMatch } from 'react-router-dom';
import { api } from '../api/client';

interface Contact {
  id: string;
  name: string;
  tier: number;
  last_contact: string;
  frequency_days: number;
  active: boolean;
}

function nextAction(lastContact: string, frequencyDays: number): string {
  if (!lastContact) return '';
  const d = new Date(lastContact);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + frequencyDays);
  return d.toISOString().slice(0, 10);
}

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const navigate = useNavigate();
  const match = useMatch('/contacts/:id');
  const selectedId = match?.params.id ?? null;
  const today = new Date().toISOString().slice(0, 10);

  function loadContacts() {
    api.get<Contact[]>('/api/contacts').then((all) =>
      setContacts(all.filter((c) => c.active !== false))
    );
  }

  useEffect(() => {
    loadContacts();
    window.addEventListener('kit:contact-updated', loadContacts);
    return () => window.removeEventListener('kit:contact-updated', loadContacts);
  }, []);

  const sorted = [...contacts].sort((a, b) => {
    const na = nextAction(a.last_contact, a.frequency_days) || '9999';
    const nb = nextAction(b.last_contact, b.frequency_days) || '9999';
    return na.localeCompare(nb);
  });

  return (
    <div className="contacts-panel">
      <div className="contacts-panel-header">Contacts</div>
      <div className="contacts-panel-list">
        {sorted.map((c) => {
          const next = nextAction(c.last_contact, c.frequency_days);
          const overdue = next && next < today;
          const isSelected = c.id === selectedId;
          return (
            <div
              key={c.id}
              className={`contact-row${isSelected ? ' contact-row-active' : ''}`}
              onClick={() => navigate(`/contacts/${c.id}`)}
            >
              <div className="contact-row-name">{c.name}</div>
              {next && (
                <div className={`contact-row-date${overdue ? ' overdue' : ''}`}>
                  {next}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
