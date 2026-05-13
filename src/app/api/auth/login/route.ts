import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'fallback-secret';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const result = await client.execute({
      sql: 'SELECT id, email, username, password_hash, plan, display_name, avatar_url, referral_code FROM users WHERE email = ?',
      args: [email],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        referralCode: user.referral_code,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
