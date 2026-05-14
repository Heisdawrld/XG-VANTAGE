'use client';

import { useState } from 'react';

interface TeamLogoProps {
  teamId?: number;
  name?: string;
  shortName?: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}

function getInitials(name: string): string {
  if (!name) return '?';
  const words = name.replace(/FC|CF|SC|AC|AS|US|SS|CA|SL|BK|RC|SK|CD|GD|FK|NK|PK|TK|IK|IF|VfL|VfB|1\.|1/ig, '').trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 30%)`;
}

export function TeamLogo({ teamId, name, shortName, logoUrl, size = 40, className = '' }: TeamLogoProps) {
  const [imgError, setImgError] = useState(false);
  const displayName = shortName || name || '?';
  const initials = getInitials(name || shortName || '');
  const bgColor = hashColor(name || String(teamId || ''));

  // If we have a logo URL and it hasn't errored, show the image
  if (logoUrl && !imgError) {
    return (
      <img
        src={logoUrl}
        alt={displayName}
        width={size}
        height={size}
        className={`object-contain ${className}`}
        onError={() => setImgError(true)}
        loading="lazy"
      />
    );
  }

  // Fallback: SVG with initials on gradient background
  return (
    <div
      className={`flex items-center justify-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bgColor}, ${bgColor}dd)`,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: size * 0.35,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.9)',
          letterSpacing: '0.5px',
          lineHeight: 1,
        }}
      >
        {initials}
      </span>
    </div>
  );
}
