import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  try {
    const { email, username, password } = await req.json();

    if (!email || !username || !password) {
      return NextResponse.json({ error: 'Email, username, and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Check if user exists
    const existing = await client.execute({
      sql: 'SELECT id FROM users WHERE email = ? OR username = ?',
      args: [email, username],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json({ error: 'Email or username already exists' }, { status: 409 });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    const referralCode = `XG${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    await client.execute({
      sql: `INSERT INTO users (id, email, username, password_hash, plan, referral_code, plan_expires_at)
            VALUES (?, ?, ?, ?, 'premium', ?, datetime('now', '+7 days'))`,
      args: [id, email, username, passwordHash, referralCode],
    });

    return NextResponse.json({
      id, email, username, plan: 'premium', referralCode,
      message: 'Account created with 7-day free trial',
    }, { status: 201 });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
