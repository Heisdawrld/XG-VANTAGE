'use client';

import { useState, useRef } from 'react';
import { Send, Bot, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatTabProps {
  fixture: Record<string, unknown>;
}

const SUGGESTIONS = [
  'Analyze form',
  'Explain tactics',
  'Value bets',
  'Match outcome',
];

export function AIChatTab({ fixture }: AIChatTabProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hi! I'm your AI analyst for this match. Ask me anything about tactics, form, or value opportunities.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const homeTeam = fixture.homeTeam as Record<string, string> | undefined;
  const awayTeam = fixture.awayTeam as Record<string, string> | undefined;

  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg) return;

    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response
    await new Promise((r) => setTimeout(r, 1500));

    const responses: Record<string, string> = {
      'Analyze form': `${homeTeam?.name || 'Home'} have shown strong home form recently with a solid defensive record. ${awayTeam?.name || 'Away'} have been inconsistent on the road. The home advantage factor is notable here.`,
      'Explain tactics': `Both teams typically set up in compact mid-blocks. ${homeTeam?.name || 'Home'} prefer build-up play while ${awayTeam?.name || 'Away'} look to exploit transitions. This creates an interesting tactical matchup.`,
      'Value bets': `Based on our model's analysis, there appears to be value in the under goals market. The probability calculation suggests the bookmaker odds are overestimating the likelihood of a high-scoring game.`,
      'Match outcome': `Our ensemble model gives ${homeTeam?.name || 'Home'} a slight edge, but this is a competitive fixture. The confidence level suggests a moderate lean toward the home side, with the draw also in play.`,
    };

    const response = responses[msg] || `Great question about the ${homeTeam?.name || 'Home'} vs ${awayTeam?.name || 'Away'} matchup. Based on our analysis, this looks like a closely contested match. Key factors include recent form, home advantage, and tactical compatibility. The xG models suggest a relatively tight game.`;

    setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
    setIsTyping(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-[rgba(16,231,116,0.1)] flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-[#10e774]" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-[rgba(16,231,116,0.1)] border border-[rgba(16,231,116,0.15)] text-white'
                  : 'glass-card text-[#9ca3af]'
              }`}
            >
              {msg.content}
            </div>
          </motion.div>
        ))}

        {isTyping && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-lg bg-[rgba(16,231,116,0.1)] flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-[#10e774]" />
            </div>
            <div className="glass-card rounded-2xl px-4 py-2.5">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#10e774] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#10e774] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[#10e774] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2">
          <div className="flex gap-2 flex-wrap">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSend(s)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-xs text-[#9ca3af] hover:border-[rgba(16,231,116,0.2)] hover:text-white transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 pt-2 border-t border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about this match..."
            className="input-dark text-sm"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isTyping}
            className="w-10 h-10 rounded-xl gradient-green flex items-center justify-center flex-shrink-0 disabled:opacity-50 transition-opacity"
          >
            <Send className="w-4 h-4 text-[#060a0e]" />
          </button>
        </div>
      </div>
    </div>
  );
}
