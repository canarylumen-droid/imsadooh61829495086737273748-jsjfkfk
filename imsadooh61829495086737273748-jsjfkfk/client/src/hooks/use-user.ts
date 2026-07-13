import { useQuery } from "@tanstack/react-query";

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  plan?: string;
  role?: string;
  avatar?: string;
  supabaseId?: string;
  metadata?: Record<string, any>;
  leadCount?: number;
  voiceMinutesUsed?: number;
}

async function fetchUser(): Promise<User | null> {
  try {
    // Try session-based auth first (password auth)
    const sessionResponse = await fetch('/api/user/profile', {
      credentials: 'include',
    });

    if (sessionResponse.ok) {
      const userData = await sessionResponse.json();
      return userData;
    }

    // Fallback to Supabase auth if configured
    const supabaseResponse = await fetch('/api/auth/me', {
      credentials: 'include',
    });

    if (supabaseResponse.ok) {
      return supabaseResponse.json();
    }

    return null;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
}

export function useUser(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['user'],
    queryFn: fetchUser,
    retry: false,
    enabled: options.enabled ?? true,
  });
}
