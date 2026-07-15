
import { toast } from '@/hooks/use-toast';

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export async function apiClient<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Use server-provided error details with tip support
      let title = error.error || 'Error';
      let description = error.details || error.message || 'Something went wrong';
      let tip = error.tip || '';

      if (response.status === 401) {
        title = 'Session Expired';
        description = 'Please sign in to continue';
        const path = window.location.pathname;
        if (path.startsWith('/dashboard') || path.startsWith('/admin')) {
          toast({ variant: 'destructive', title, description, duration: 3000 });
          setTimeout(() => { window.location.href = '/auth'; }, 2000);
          throw new APIError(401, 'Session expired');
        }
      } else if (response.status === 403) {
        title = 'Access Denied';
        description = error.message || 'You do not have permission for this action';
      } else if (response.status === 429) {
        title = 'Rate Limited';
        description = error.message || 'Too many requests. Please try again later.';
      } else if (response.status === 400) {
        title = error.error || 'Validation Error';
        description = error.details || error.message || 'Invalid request';
      } else if (response.status >= 500) {
        title = 'Server Error';
        description = error.details || error.message || 'Our team has been notified.';
      }

      // Format the message with tip if available
      const fullMessage = tip ? `${description}\n\n💡 ${tip}` : description;

      toast({
        variant: 'destructive',
        title,
        description: fullMessage,
        duration: tip ? 8000 : 5000,
      });

      throw new APIError(response.status, fullMessage, error.code);
    }

    return response.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    // Network errors
    toast({
      variant: 'destructive',
      title: 'Connection Error',
      description: 'Please check your internet connection',
    });

    throw new APIError(0, 'Network error');
  }
}
