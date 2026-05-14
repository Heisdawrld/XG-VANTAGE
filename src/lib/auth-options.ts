import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { client } from '@/lib/db-turso';
import { compare } from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const result = await client.execute({
          sql: 'SELECT id, email, username, password_hash, display_name FROM users WHERE email = ?',
          args: [credentials.email],
        });

        if (result.rows.length === 0) return null;

        const user = result.rows[0];
        const passwordHash = user.password_hash as string;
        if (!passwordHash) return null;

        // Try bcryptjs compare first (production hashing)
        let isValid = false;
        try {
          isValid = await compare(credentials.password, passwordHash);
        } catch {
          // Fallback: check if it's a sha256 hash (dev/simple setup)
          const crypto = await import('crypto');
          const sha256Hash = crypto
            .createHash('sha256')
            .update(credentials.password)
            .digest('hex');
          isValid = sha256Hash === passwordHash;
        }

        if (!isValid) return null;

        return {
          id: user.id as string,
          email: user.email as string,
          name: (user.display_name || user.username) as string,
        };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/api/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.id;
      }
      return session;
    },
  },
};
