import { NextResponse } from 'next/server';

// Lightweight health check for Render — does NOT touch the database
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'xG-Vantage',
    timestamp: new Date().toISOString(),
  });
}
