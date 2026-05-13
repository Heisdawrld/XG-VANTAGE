import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  username: string;
  plan: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  referralCode?: string | null;
  planExpiresAt?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  login: (token, user) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('xg_token', token);
      localStorage.setItem('xg_user', JSON.stringify(user));
    }
    set({ token, user, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('xg_token');
      localStorage.removeItem('xg_user');
    }
    set({ token: null, user: null, isAuthenticated: false, isLoading: false });
  },

  updateUser: (updates) => {
    set((state) => {
      const newUser = state.user ? { ...state.user, ...updates } : null;
      if (typeof window !== 'undefined' && newUser) {
        localStorage.setItem('xg_user', JSON.stringify(newUser));
      }
      return { user: newUser };
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  initialize: () => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('xg_token');
      const userStr = localStorage.getItem('xg_user');
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr);
          set({ token, user, isAuthenticated: true, isLoading: false });
        } catch {
          set({ isLoading: false });
        }
      } else {
        set({ isLoading: false });
      }
    }
  },
}));
