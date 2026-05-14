'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, CreditCard, Trophy, Flag, LogOut, Check, Crown } from 'lucide-react';
import Link from 'next/link';
import { BottomNav } from '@/components/layout/bottom-nav';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';

export default function ProfilePage() {
  const { user, logout, updateUser } = useAuthStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('xg_token') : null;
        if (token) {
          const data = await api.getMe();
          updateUser(data);
        }
      } catch {
        // silent
      }
    };
    fetchUser();
  }, [updateUser]);

  const handleCopyCode = () => {
    if (user?.referralCode) {
      navigator.clipboard.writeText(user.referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyLink = () => {
    const link = `https://xg-vantage.com/ref/${user?.referralCode || ''}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#060a0e]">
      <main className="flex-1 pb-24 max-w-2xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="p-4 space-y-4"
        >
          {/* User Card */}
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl gradient-green flex items-center justify-center glow-green">
                <span className="text-xl font-bold text-[#060a0e]">
                  {(user?.username || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">{user?.username || 'Guest'}</h2>
                  <span className="badge-green flex items-center gap-1">
                    <Crown className="w-2.5 h-2.5" />
                    PREMIUM
                  </span>
                </div>
                <p className="text-sm text-[#9ca3af]">{user?.email || ''}</p>
              </div>
            </div>
          </div>

          {/* Quick Nav */}
          <div className="grid grid-cols-3 gap-3">
            <Link href="/profile" className="glass-card glass-card-hover rounded-2xl p-3 text-center transition-all">
              <CreditCard className="w-5 h-5 text-[#10e774] mx-auto mb-1" />
              <span className="text-[10px] font-semibold text-[#9ca3af]">BILLING</span>
            </Link>
            <Link href="/track-record" className="glass-card glass-card-hover rounded-2xl p-3 text-center transition-all">
              <Trophy className="w-5 h-5 text-[#f59e0b] mx-auto mb-1" />
              <span className="text-[10px] font-semibold text-[#9ca3af]">TRACK</span>
            </Link>
            <Link href="/matches" className="glass-card glass-card-hover rounded-2xl p-3 text-center transition-all">
              <Flag className="w-5 h-5 text-[#60a5fa] mx-auto mb-1" />
              <span className="text-[10px] font-semibold text-[#9ca3af]">LEAGUES</span>
            </Link>
          </div>

          {/* Performance */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-4">Performance (30D)</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-[#10e774]">62.4%</p>
                <p className="text-[10px] text-[#9ca3af]">Win Rate</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-white">127</p>
                <p className="text-[10px] text-[#9ca3af]">Won</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-[#ef4444]">76</p>
                <p className="text-[10px] text-[#9ca3af]">Lost</p>
              </div>
            </div>
          </div>

          {/* Premium Plan */}
          <div className="relative rounded-2xl p-[1px] overflow-hidden" style={{
            background: 'linear-gradient(135deg, rgba(16, 231, 116, 0.2), rgba(0, 255, 136, 0.05))',
          }}>
            <div className="rounded-2xl p-5" style={{ background: 'radial-gradient(circle at top left, rgba(16, 231, 116, 0.08), #0a110d 70%)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[#ffd700]" />
                  <span className="text-sm font-bold text-white">Premium Plan</span>
                </div>
                <span className="badge-green">ACTIVE</span>
              </div>
              <p className="text-xs text-[#9ca3af] mb-3">
                Active until {user?.planExpiresAt ? new Date(user.planExpiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
              </p>
              <div className="space-y-1.5">
                {['Unlimited predictions', 'AI Chat access', 'ACCA builder', 'Priority support'].map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-[#10e774]" />
                    <span className="text-xs text-[#9ca3af]">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Refer & Earn */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Refer & Earn</h3>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
                <span className="text-sm font-mono text-white">{user?.referralCode || 'XGDEMO'}</span>
              </div>
              <button
                onClick={handleCopyCode}
                className="px-3 py-2 rounded-lg bg-[rgba(16,231,116,0.1)] border border-[rgba(16,231,116,0.15)] text-xs font-semibold text-[#10e774] hover:bg-[rgba(16,231,116,0.15)] transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={handleCopyLink}
              className="w-full py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] text-xs text-[#9ca3af] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              Copy referral link
            </button>
          </div>

          {/* Settings Cards */}
          <div className="space-y-2">
            {[
              { icon: CreditCard, label: 'Payment & Billing', href: '/profile' },
              { icon: Settings, label: 'Account Settings', href: '/profile' },
              { icon: Trophy, label: 'Track Record', href: '/track-record' },
              { icon: Flag, label: 'Favourite Leagues', href: '/matches' },
            ].map(({ icon: Icon, label, href }) => (
              <Link
                key={label}
                href={href}
                className="glass-card glass-card-hover rounded-2xl p-4 flex items-center gap-3 transition-all"
              >
                <div className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center">
                  <Icon className="w-4 h-4 text-[#9ca3af]" />
                </div>
                <span className="text-sm text-white flex-1">{label}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </div>

          {/* Sign Out */}
          <button
            onClick={() => logout()}
            className="w-full py-3 rounded-2xl bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.12)] text-sm font-semibold text-[#ef4444] hover:bg-[rgba(239,68,68,0.12)] transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </motion.div>
      </main>

      <BottomNav />
    </div>
  );
}
