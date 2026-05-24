import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (res.status === 401) {
    // If we're on a dashboard page and get a 401, redirect to login
    if (window.location.pathname.startsWith('/dashboard')) {
      console.warn('Unauthorized access detected, redirecting to auth...');
      localStorage.removeItem('userId');
      localStorage.removeItem('user');
      window.location.href = '/auth';
    }
  }

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function getBaseUrl() {
  // Railway integrated deployments always use relative API paths
  // to ensure smooth routing when frontend and backend are housed together.
  return '';
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getBaseUrl();
  const finalUrl = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;

  const res = await fetch(finalUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      let url = "";
      const queryParams = new URLSearchParams();

      queryKey.forEach((part) => {
        if (typeof part === "string") {
          if (url && !url.endsWith("/") && !part.startsWith("/")) {
            url += "/";
          }
          url += part;
        } else if (typeof part === "object" && part !== null) {
          Object.entries(part).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              queryParams.append(key, String(value));
            }
          });
        }
      });

      const queryString = queryParams.toString();
      const baseUrl = getBaseUrl();
      const relativeUrl = queryString
        ? `${url}${url.includes("?") ? "&" : "?"}${queryString}`
        : url;
      const finalUrl = relativeUrl.startsWith('/') ? `${baseUrl}${relativeUrl}` : `${baseUrl}/${relativeUrl}`;

      const res = await fetch(finalUrl, {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 1000 * 60, // 60 seconds - data considered fresh for 1 minute
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: false,
      refetchOnMount: false, // Prevents refetching immediately when component remounts
    },
    mutations: {
      retry: false,
    },
  },
});
