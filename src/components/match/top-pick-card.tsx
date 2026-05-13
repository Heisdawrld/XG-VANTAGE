'use client';

import { Flame, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { ConfidenceRing } from '@/components/shared/confidence-ring';

interface TopPickCardProps {
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  confidence: number;
  onClose?: () => void;
}

export function TopPickCard({ homeTeam, awayTeam, prediction, confidence, onClose }: TopPickCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-2xl p-[1px] overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(16, 231, 116, 0.3), rgba(0, 255, 136, 0.1), rgba(16, 231, 116, 0.05))',
      }}
    >
      {/* Inner card */}
      <div
        className="rounded-2xl p-5 relative overflow-hidden"
        style={{
          background: 'radial-gradient(circle at top left, rgba(16, 231, 116, 0.1), #0a110d 70%)',
        }}
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-6 h-6 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.12)] transition-colors"
          >
            <X className="w-3 h-3 text-[#9ca3af]" />
          </button>
        )}

        {/* Badge */}
        <div className="flex items-center gap-1.5 mb-4">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[rgba(16,231,116,0.15)] border border-[rgba(16,231,116,0.2)]">
            <Flame className="w-3 h-3 text-[#10e774]" />
            <span className="text-[10px] font-bold text-[#10e774] uppercase tracking-wider">Top Pick</span>
          </div>
        </div>

        {/* Match */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1">
            <p className="text-base font-bold text-white">{homeTeam}</p>
          </div>
          <div className="px-3">
            <span className="text-xs text-[#9ca3af] font-medium">VS</span>
          </div>
          <div className="flex-1 text-right">
            <p className="text-base font-bold text-white">{awayTeam}</p>
          </div>
        </div>

        {/* Prediction + Confidence */}
        <div className="flex items-center justify-between">
          <div className="px-4 py-2 rounded-xl bg-[rgba(16,231,116,0.1)] border border-[rgba(16,231,116,0.15)]">
            <span className="text-sm font-bold text-[#10e774]">{prediction}</span>
          </div>
          <ConfidenceRing confidence={confidence} size={52} />
        </div>
      </div>
    </motion.div>
  );
}
