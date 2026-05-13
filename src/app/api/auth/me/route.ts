import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/db-turso';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'fallback-secret';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string };

    const result = await client.execute({
      sql: 'SELECT id, email, username, plan, display_name, avatar_url, referral_code, plan_expires_at FROM users WHERE id = ?',
      args: [decoded.id],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = result.rows[0];
    const planExpiresAt = user.plan_expires_at as string | null;
    const isExpired = planExpiresAt ? new Date(planExpiresAt) < new Date() : true;

    return NextResponse.json({
      id: user.id,
      email: user.email,
      username: user.username,
      plan: isExpired ? 'free' : user.plan,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      referralCode: user.referral_code,
      planExpiresAt: user.plan_expires_at,
      isExpired,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
}
