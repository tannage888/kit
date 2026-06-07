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

export default function ChatPanel() {
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
      const data = await api.post<ChatResponse>('/api/chat', {
        message: text,
        history: next.slice(0, -1),
      });

      for (const tc of data.tool_calls) {
        setActiveTool(TOOL_LABELS[tc.name] ?? tc.name);
        await new Promise((r) => setTimeout(r, 300));
      }
      setActiveTool(null);
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch (err: unknown) {
      setActiveTool(null);
      setMessages([...next, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-column">
      <div className="chat-panel-header">
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Chat</span>
        <button
          onClick={() => setMessages([])}
          title="Clear conversation"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: '0.8rem', marginLeft: 'auto' }}
        >
          Clear
        </button>
      </div>

      <div className="chat-panel-messages">
        {messages.length === 0 && (
          <p style={{ color: '#444', fontSize: '0.82rem', padding: '0.5rem 0' }}>
            Ask anything — "who should I reach out to?", "log I spoke to Peter", "prep me for Alice"
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
            {msg.content}
          </div>
        ))}

        {activeTool && (
          <div className="chat-tool-indicator">🔧 {activeTool}…</div>
        )}

        {loading && !activeTool && (
          <div className="chat-tool-indicator">…</div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-panel-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message Kit… (Enter to send)"
          disabled={loading}
          rows={2}
          className="chat-textarea"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="chat-send-btn"
        >
          Send
        </button>
      </div>
    </div>
  );
}
