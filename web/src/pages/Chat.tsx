import { useState, useRef, useEffect } from 'react';
import { api } from '../api/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
}

interface ChatResponse {
  reply: string;
  tool_calls: ToolCall[];
}

const TOOL_LABELS: Record<string, string> = {
  'get-queue': 'Checking contact queue',
  'get-contact': 'Looking up contact',
  'search-contacts': 'Searching contacts',
  'log-interaction': 'Logging interaction',
  'add-follow-up': 'Adding follow-up',
  'complete-follow-up': 'Completing follow-up',
  'kit-daily-checkin': 'Running check-in',
  'kit-set-energy': 'Setting energy level',
  'kit-get-energy': 'Checking energy',
  'sweep-now': 'Running sweep',
  'kit-prep-card': 'Building prep card',
  'kit-draft-context': 'Getting draft context',
  'kit-reconnect-context': 'Building reconnect brief',
  'kit-pending-captures': 'Fetching captures',
  'kit-confirm-capture': 'Confirming capture',
  'kit-dismiss-capture': 'Dismissing capture',
  'create-contact': 'Creating contact',
  'set-contact-active': 'Updating contact status',
};

const bubble: React.CSSProperties = {
  maxWidth: '80%',
  borderRadius: 12,
  padding: '0.65rem 1rem',
  fontSize: '0.9rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setLoading(true);

    try {
      const history = next.slice(0, -1);
      const data = await api.post<ChatResponse>('/api/chat', { message: text, history });

      // Show tool activity one by one (best-effort UX — tools already ran server-side)
      for (const tc of data.tool_calls) {
        setActiveTool(TOOL_LABELS[tc.name] ?? tc.name);
        await new Promise((r) => setTimeout(r, 400));
      }
      setActiveTool(null);

      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch (err: unknown) {
      setActiveTool(null);
      setMessages([...next, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 2rem)' }}>
      <h1 style={{ marginBottom: '1rem', flexShrink: 0 }}>Chat</h1>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingBottom: '1rem' }}>
        {messages.length === 0 && (
          <p style={{ color: '#555', fontSize: '0.9rem' }}>
            Ask anything — "who should I reach out to today?", "log that I spoke to Peter", "prep me for a call with Alice"
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              ...bubble,
              background: msg.role === 'user' ? '#7c6fcd' : '#1e1e35',
              color: '#e0e0e0',
              border: msg.role === 'assistant' ? '1px solid #333' : 'none',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {activeTool && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ ...bubble, background: '#1e1e35', border: '1px solid #333', color: '#7c6fcd', fontStyle: 'italic', fontSize: '0.82rem' }}>
              🔧 {activeTool}…
            </div>
          </div>
        )}

        {loading && !activeTool && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ ...bubble, background: '#1e1e35', border: '1px solid #333', color: '#555' }}>
              …
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, paddingTop: '0.5rem', borderTop: '1px solid #222' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Kit…"
          disabled={loading}
          style={{
            flex: 1,
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#e0e0e0',
            padding: '0.6rem 0.9rem',
            fontSize: '0.9rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            background: '#7c6fcd',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0.6rem 1.2rem',
            fontSize: '0.9rem',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
