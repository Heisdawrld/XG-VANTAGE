import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'xG-Vantage API', version: '2.0' });
}
