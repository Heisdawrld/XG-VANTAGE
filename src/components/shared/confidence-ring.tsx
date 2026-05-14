'use client';

import { motion } from 'framer-motion';

interface ConfidenceRingProps {
  confidence: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  className?: string;
}

export function ConfidenceRing({
  confidence,
  size = 56,
  strokeWidth = 4,
  showLabel = true,
  className = '',
}: ConfidenceRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (confidence / 100) * circumference;

  const color =
    confidence >= 75 ? '#10e774' : confidence >= 60 ? '#f59e0b' : '#ef4444';
  const glowColor =
    confidence >= 75
      ? 'rgba(16, 231, 116, 0.3)'
      : confidence >= 60
        ? 'rgba(245, 158, 11, 0.3)'
        : 'rgba(239, 68, 68, 0.3)';

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold leading-none"
            style={{
              fontSize: size * 0.26,
              color,
            }}
          >
            {Math.round(confidence)}
          </span>
          <span
            className="text-[8px] font-medium uppercase tracking-wider"
            style={{
              color: 'rgba(255,255,255,0.35)',
              fontSize: size * 0.14,
            }}
          >
            conf
          </span>
        </div>
      )}
    </div>
  );
}
