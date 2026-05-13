'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login(email, password);
      login(data.token, data.user);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background Glow Orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full glow-orb" style={{ background: 'radial-gradient(circle, rgba(16, 231, 116, 0.08), transparent 70%)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full glow-orb" style={{ background: 'radial-gradient(circle, rgba(16, 231, 116, 0.06), transparent 70%)', animationDelay: '2s' }} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl gradient-green flex items-center justify-center mx-auto mb-4 glow-green">
            <span className="text-[#060a0e] font-bold text-xl">xG</span>
          </div>
          <h1 className="text-2xl font-bold text-white font-[family-name:var(--font-space-grotesk)]">
            Welcome back
          </h1>
          <p className="text-sm text-[#9ca3af] mt-1">Sign in to your account</p>
        </div>

        {/* Premium Chips */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="badge-green">Free 7-Day Trial</span>
          <span className="badge-green">No Card Required</span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] text-sm text-[#ef4444]">
              {error}
            </div>
          )}

          {/* Email */}
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.25)]" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              required
              className="input-dark pl-10"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.25)]" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="input-dark pl-10 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4 text-[rgba(255,255,255,0.25)]" />
              ) : (
                <Eye className="w-4 h-4 text-[rgba(255,255,255,0.25)]" />
              )}
            </button>
          </div>

          {/* Forgot Password */}
          <div className="text-right">
            <button type="button" className="text-xs text-[#10e774] hover:underline">
              Forgot your password?
            </button>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-[#060a0e] border-t-transparent rounded-full animate-spin" />
            ) : (
              'Sign in'
            )}
          </button>

          {/* Google */}
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-sm text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </form>

        {/* Sign Up Link */}
        <p className="text-center text-sm text-[#9ca3af] mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-[#10e774] font-semibold hover:underline">
            Sign up free
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
