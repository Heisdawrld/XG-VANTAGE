'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, ChevronDown, LogOut, User, Settings, Trophy } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import Link from 'next/link';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { activeSport, setActiveSport } = useUIStore();
  const [showDropdown, setShowDropdown] = useState(false);
  const [notifCount] = useState(3);

  return (
    <header className="sticky top-0 z-50 glass-card">
      <div className="flex items-center justify-between px-4 py-3 max-w-2xl mx-auto">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-green flex items-center justify-center">
            <span className="text-[#060a0e] font-bold text-xs">xG</span>
          </div>
          <span className="text-base font-bold text-white font-[family-name:var(--font-space-grotesk)]">
            Vantage
          </span>
        </Link>

        {/* Sport Toggle */}
        <div className="flex items-center bg-[rgba(255,255,255,0.04)] rounded-full p-0.5">
          <button
            onClick={() => setActiveSport('football')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeSport === 'football'
                ? 'bg-[#10e774] text-[#060a0e]'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            FOOTBALL
          </button>
          <button
            onClick={() => setActiveSport('basketball')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeSport === 'basketball'
                ? 'bg-[#10e774] text-[#060a0e]'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            BASKETBALL
          </button>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Notification Bell */}
          <button className="relative w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors">
            <Bell className="w-4 h-4 text-[#9ca3af]" />
            {notifCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#ef4444] text-[9px] text-white font-bold flex items-center justify-center">
                {notifCount}
              </span>
            )}
          </button>

          {/* User Avatar */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-lg object-cover" />
              ) : (
                <User className="w-4 h-4 text-[#9ca3af]" />
              )}
            </button>

            <AnimatePresence>
              {showDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowDropdown(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-12 z-50 w-52 rounded-xl glass-card border-[rgba(255,255,255,0.08)] overflow-hidden"
                  >
                    <div className="p-3 border-b border-[rgba(255,255,255,0.06)]">
                      <p className="text-sm font-semibold text-white truncate">
                        {user?.username || 'Guest'}
                      </p>
                      <p className="text-[10px] text-[#9ca3af] truncate">{user?.email || ''}</p>
                    </div>
                    <div className="p-1">
                      <Link
                        href="/profile"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#9ca3af] hover:text-white hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Account
                      </Link>
                      <Link
                        href="/track-record"
                        onClick={() => setShowDropdown(false)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#9ca3af] hover:text-white hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                      >
                        <Trophy className="w-3.5 h-3.5" />
                        Track Record
                      </Link>
                      <button
                        onClick={() => {
                          logout();
                          setShowDropdown(false);
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[#ef4444] hover:bg-[rgba(239,68,68,0.08)] transition-colors w-full"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
