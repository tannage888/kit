import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

interface ContactSweepResult {
  contactId: string;
  contactName: string;
  messagesFound: number;
  threadsProcessed: number;
  skipped: boolean;
  error?: string;
}

interface SweepResult {
  startedAt: string;
  completedAt: string;
  contactsSwept: number;
  contactsSkipped: number;
  threadsProcessed: number;
  errors: number;
  details: ContactSweepResult[];
}

interface SweepStatus {
  lastResult: SweepResult | null;
  nextSweepAt: string | null;
}

export default function Sweep() {
  const [status, setStatus] = useState<SweepStatus | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    try {
      const s = await api.get<SweepStatus>('/api/sweep/status');
      setStatus(s);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (sweeping) {
      pollRef.current = setInterval(fetchStatus, 3000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sweeping]);

  async function triggerSweep() {
    setError(null);
    setSweeping(true);
    try {
      const result = await api.post<SweepResult>('/api/sweep/run', {});
      setStatus((prev) => ({ ...prev!, lastResult: result }));
    } catch (e: any) {
      if (e.message.includes('409')) {
        setError('Sweep already in progress.');
      } else {
        setError(e.message);
      }
    } finally {
      setSweeping(false);
    }
  }

  const last = status?.lastResult;

  return (
    <div className="page sweep-page">
      <div className="page-header">
        <h1>Sweep</h1>
        <button
          className="btn btn-primary"
          onClick={triggerSweep}
          disabled={sweeping}
        >
          {sweeping ? 'Sweeping…' : 'Run Sweep Now'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {sweeping && (
        <div className="sweep-progress">
          <span className="spinner" /> Sweep in progress — refreshing every 3 s…
        </div>
      )}

      {status?.nextSweepAt && (
        <p className="sweep-next">
          Next scheduled sweep: {new Date(status.nextSweepAt).toLocaleString()}
        </p>
      )}

      {last ? (
        <div className="sweep-result">
          <h2>Last Sweep</h2>
          <div className="sweep-summary">
            <div className="stat">
              <span className="stat-value">{last.contactsSwept}</span>
              <span className="stat-label">contacts swept</span>
            </div>
            <div className="stat">
              <span className="stat-value">{last.contactsSkipped}</span>
              <span className="stat-label">skipped</span>
            </div>
            <div className="stat">
              <span className="stat-value">{last.threadsProcessed}</span>
              <span className="stat-label">threads processed</span>
            </div>
            {last.errors > 0 && (
              <div className="stat stat-error">
                <span className="stat-value">{last.errors}</span>
                <span className="stat-label">errors</span>
              </div>
            )}
          </div>
          <p className="sweep-time">
            {new Date(last.startedAt).toLocaleString()} →{' '}
            {new Date(last.completedAt).toLocaleString()}
          </p>

          {last.details.length > 0 && (
            <table className="sweep-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Messages</th>
                  <th>Threads</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {last.details.map((d) => (
                  <tr key={d.contactId} className={d.error ? 'row-error' : d.skipped ? 'row-skipped' : ''}>
                    <td>{d.contactName}</td>
                    <td>{d.messagesFound}</td>
                    <td>{d.threadsProcessed}</td>
                    <td>
                      {d.error ? (
                        <span className="badge badge-error" title={d.error}>Error</span>
                      ) : d.skipped ? (
                        <span className="badge badge-skipped">Skipped</span>
                      ) : (
                        <span className="badge badge-ok">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        !sweeping && <p className="sweep-empty">No sweep results yet. Run a sweep to see results.</p>
      )}
    </div>
  );
}
