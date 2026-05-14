'use client';

import { useState, useMemo } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { format, addDays } from 'date-fns';

export function DateSelector() {
  const { activeDate, setActiveDate } = useUIStore();

  const dates = useMemo(() => {
    const result = [];
    const today = new Date();
    for (let i = -1; i <= 6; i++) {
      const d = addDays(today, i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayName = i === -1 ? 'YEST' : i === 0 ? 'TODAY' : i === 1 ? 'TOM' : format(d, 'EEE').toUpperCase();
      const dayNum = format(d, 'dd');
      result.push({ dateStr, dayName, dayNum, isToday: i === 0 });
    }
    return result;
  }, []);

  return (
    <div className="scroll-x flex gap-2 px-4 py-2">
      {dates.map(({ dateStr, dayName, dayNum, isToday }) => {
        const isActive = activeDate === dateStr;
        return (
          <button
            key={dateStr}
            onClick={() => setActiveDate(dateStr)}
            className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl transition-all ${
              isActive
                ? 'bg-[#10e774] text-[#060a0e]'
                : 'bg-[rgba(255,255,255,0.04)] text-[#9ca3af] hover:bg-[rgba(255,255,255,0.08)]'
            }`}
          >
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? '' : 'opacity-70'}`}>
              {dayName}
            </span>
            <span className={`text-sm font-bold ${isActive ? '' : ''}`}>
              {dayNum}
            </span>
          </button>
        );
      })}
    </div>
  );
}
