export function getOAuthRedirectUrl(provider: 'gmail' | 'google-calendar' | 'outlook' | 'instagram' | 'calendly' | 'postmaster'): string {
  const envKey = `${provider.toUpperCase().replace('-', '_')}_REDIRECT_URI`;
  if (process.env[envKey]) return process.env[envKey]!;

  const basePath = `/api/oauth/${provider}/callback`;

  // Production: DOMAIN env or default to audnixai.com
  if (process.env.NODE_ENV === 'production') {
    const domain = process.env.DOMAIN || 'audnixai.com';
    return `https://${domain}${basePath}`;
  }

  // Development: DOMAIN, BASE_URL, or fallback to localhost
  const domain = process.env.DOMAIN || process.env.BASE_URL?.replace(/^https?:\/\//, '');
  if (domain) {
    const protocol = process.env.BASE_URL?.startsWith('http') ? '' : 'https://';
    return `${protocol}${domain}${basePath}`;
  }

  return `http://localhost:5000${basePath}`;
}

export function getAllOAuthRedirectUrls() {
  return {
    gmail: getOAuthRedirectUrl('gmail'),
    googleCalendar: getOAuthRedirectUrl('google-calendar'),
    outlook: getOAuthRedirectUrl('outlook'),
    instagram: getOAuthRedirectUrl('instagram'),

    calendly: getOAuthRedirectUrl('calendly')
  };
}
