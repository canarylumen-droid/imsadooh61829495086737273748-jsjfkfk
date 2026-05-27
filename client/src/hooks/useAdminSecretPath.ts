/**
 * Hook to get admin URL path.
 * Security note: the actual admin route protection is enforced server-side via requireAdmin middleware.
 * The client-side path is not a security boundary.
 */
export function useAdminSecretPath(): string {
  return '/admin';
}
