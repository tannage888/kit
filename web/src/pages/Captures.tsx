import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface PendingReview {
  contactId: string;
  contactName: string;
  summary: string;
  messageCount: number;
  periodStart: string;
  periodEnd: string;
}

export default function Captures() {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  function load() {
    setLoading(true);
    api.get<PendingReview[]>('/api/captures/pending')
      .then(setReviews)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function approve(contactId: string) {
    setPending((p) => ({ ...p, [contactId]: true }));
    try {
      await api.post(`/api/captures/confirm/${contactId}`);
      setReviews((rs) => rs.filter((r) => r.contactId !== contactId));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending((p) => ({ ...p, [contactId]: false }));
    }
  }

  async function dismiss(contactId: string) {
    setPending((p) => ({ ...p, [contactId]: true }));
    try {
      await api.post(`/api/captures/dismiss/${contactId}`);
      setReviews((rs) => rs.filter((r) => r.contactId !== contactId));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending((p) => ({ ...p, [contactId]: false }));
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1>Captures</h1>
        <button
          onClick={load}
          style={{ padding: '0.3rem 0.8rem', borderRadius: 4, border: '1px solid #333', background: 'transparent', color: '#a0a0b0', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          Refresh
        </button>
      </div>

      {loading && <p style={{ color: '#a0a0b0' }}>Loading…</p>}
      {error && <p style={{ color: '#f87171' }}>Error: {error}</p>}
      {!loading && !error && reviews.length === 0 && (
        <p style={{ color: '#a0a0b0' }}>No pending captures.</p>
      )}

      {reviews.map((r) => (
        <div
          key={r.contactId}
          style={{
            background: '#16162a',
            borderRadius: 8,
            padding: '1.25rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{r.contactName}</h3>
            <span style={{ color: '#a0a0b0', fontSize: '0.8rem' }}>
              {r.messageCount} messages · {r.periodStart?.slice(0, 10)} – {r.periodEnd?.slice(0, 10)}
            </span>
          </div>

          <p style={{ color: '#c0c0d0', lineHeight: 1.6, marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>
            {r.summary}
          </p>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              disabled={pending[r.contactId]}
              onClick={() => approve(r.contactId)}
              style={{
                padding: '0.4rem 1rem',
                borderRadius: 4,
                border: 'none',
                background: '#4ade8033',
                color: '#4ade80',
                cursor: 'pointer',
                fontWeight: 600,
                opacity: pending[r.contactId] ? 0.5 : 1,
              }}
            >
              Approve
            </button>
            <button
              disabled={pending[r.contactId]}
              onClick={() => dismiss(r.contactId)}
              style={{
                padding: '0.4rem 1rem',
                borderRadius: 4,
                border: 'none',
                background: '#f8717133',
                color: '#f87171',
                cursor: 'pointer',
                fontWeight: 600,
                opacity: pending[r.contactId] ? 0.5 : 1,
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
