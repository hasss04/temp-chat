import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { ArrowDown, MessageCircle, Send } from 'lucide-react';
import type { PlainMessage } from '../types';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ts: number) {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';
  if (today.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function initialsOf(name: string) {
  return (name || 'A').trim().slice(0, 2).toUpperCase();
}

function isSameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  isMe,
  startsGroup,
  endsGroup,
  showAvatar,
  connected,
}: {
  message: PlainMessage;
  isMe: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  showAvatar: boolean;
  connected: boolean;
}) {
  return (
    <div className={`msg-row ${isMe ? 'me' : 'peer'} msg-enter`}>
      {!isMe && (
        <span
          className={`msg-avatar ${showAvatar ? '' : 'ghost'}`}
          aria-hidden={!showAvatar}
        >
          {showAvatar ? initialsOf('Peer') : ''}
        </span>
      )}
      <div className={`msg-stack ${isMe ? 'me' : 'peer'}`}>
        <div
          className={[
            'bubble',
            isMe ? 'me' : 'peer',
            startsGroup ? 'group-start' : '',
            endsGroup ? 'group-end' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {message.text}
        </div>
        {endsGroup && (
          <div className={`msg-footer ${isMe ? 'me' : 'peer'}`}>
            <span className="msg-time">{formatTime(message.createdAt)}</span>
            {isMe && (
              <span
                className={`msg-status ${message.seenAt ? 'seen' : ''}`}
                aria-label={
                  message.seenAt
                    ? 'Seen'
                    : message.deliveredAt
                      ? 'Delivered'
                      : connected
                        ? 'Sent'
                        : 'Pending'
                }
              >
                {message.seenAt
                  ? '\u2713\u2713'
                  : message.deliveredAt
                    ? '\u2713\u2713'
                    : connected
                      ? '\u2713'
                      : '\u2026'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div className="msg-row peer msg-enter">
      <span className="msg-avatar">{initialsOf('Peer')}</span>
      <div className="msg-stack peer">
        <div className="typing-bubble" aria-label="Peer is typing">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
});

type Props = {
  messages: PlainMessage[];
  connected: boolean;
  peerTyping: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
};

export function ChatView({ messages, connected, peerTyping, draft, onDraftChange, onSend }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const lastCountRef = useRef(messages.length);
  const composingRef = useRef(false);
  const isAtBottomRef = useRef(true);

  const isNearBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    setShowJumpButton(false);
    setUnseen(0);
    isAtBottomRef.current = true;
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [draft]);

  useEffect(() => {
    const grew = messages.length > lastCountRef.current;
    const lastIsMine = messages[messages.length - 1]?.sender === 'me';
    lastCountRef.current = messages.length;
    if (!grew) return;
    if (lastIsMine || isAtBottomRef.current) {
      scrollToBottom(messages.length <= 1 ? 'auto' : 'smooth');
    } else {
      setShowJumpButton(true);
      setUnseen((n) => n + 1);
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (peerTyping && isAtBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [peerTyping, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const atBottom = isNearBottom();
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setShowJumpButton(false);
      setUnseen(0);
    } else {
      setShowJumpButton(true);
    }
  }, [isNearBottom]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey || composingRef.current) return;
      e.preventDefault();
      if (draft.trim() && connected) onSend();
    },
    [draft, connected, onSend],
  );

  return (
    <div className="chat-view">
      <div
        className="message-log"
        role="log"
        aria-label="Message list"
        aria-live="polite"
        ref={logRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 && !peerTyping && (
          <div className="thread-empty">
            <div className="thread-empty-icon">
              <MessageCircle size={26} strokeWidth={1.5} />
            </div>
            <h3>No messages yet</h3>
            <p>
              {connected
                ? 'Say hi — messages are end-to-end encrypted and never stored on a server.'
                : 'Once the other person connects, your conversation will appear here.'}
            </p>
          </div>
        )}
        {messages.map((message, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const isMe = message.sender === 'me';
          const isSystem = message.sender === 'system';

          if (isSystem) {
            return (
              <div key={message.id} className="bubble system">
                {message.text}
              </div>
            );
          }

          const startsGroup =
            !prev ||
            prev.sender !== message.sender ||
            !isSameDay(prev.createdAt, message.createdAt) ||
            message.createdAt - prev.createdAt > 5 * 60 * 1000;

          const endsGroup =
            !next ||
            next.sender !== message.sender ||
            !isSameDay(next.createdAt, message.createdAt) ||
            next.createdAt - message.createdAt > 5 * 60 * 1000;

          const showDayDivider = !prev || !isSameDay(prev.createdAt, message.createdAt);

          return (
            <div key={message.id}>
              {showDayDivider && (
                <div className="day-divider">
                  <span>{formatDay(message.createdAt)}</span>
                </div>
              )}
              <MessageBubble
                message={message}
                isMe={isMe}
                startsGroup={startsGroup}
                endsGroup={endsGroup}
                showAvatar={!!startsGroup && !isMe}
                connected={connected}
              />
            </div>
          );
        })}
        {peerTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {showJumpButton && (
        <button
          type="button"
          className="scroll-jump-btn"
          onClick={() => scrollToBottom()}
          aria-label="Scroll to latest message"
        >
          <ArrowDown size={18} />
          {unseen > 0 && (
            <span className="scroll-jump-badge">{unseen > 99 ? '99+' : unseen}</span>
          )}
        </button>
      )}

      <div className="composer-shell">
        <div className="composer">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={() => (composingRef.current = false)}
            placeholder={connected ? 'Message' : 'Waiting for connection\u2026'}
            aria-label="Message"
            rows={1}
          />
          <button
            type="button"
            className="send-btn"
            onClick={onSend}
            disabled={!draft.trim() || !connected}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
