-- Fix old Calendly users who connected before the calendlyAccessToken fix
-- Sets calendly_access_token to a sentinel value for users who have a Calendly
-- integration but no calendly_access_token set on their users record.
-- PostgreSQL column names are snake_case, matching the drizzle schema.

UPDATE users
SET calendly_access_token = 'migrated_connected',
    updated_at = NOW()
WHERE id IN (
  SELECT DISTINCT i.user_id
  FROM integrations i
  WHERE i.provider = 'calendly'
    AND i.connected = true
)
AND (calendly_access_token IS NULL OR calendly_access_token = '');

-- Also ensure calendar_settings is enabled for these users
INSERT INTO calendar_settings (user_id, calendly_enabled, created_at, updated_at)
SELECT u.id, true, NOW(), NOW()
FROM users u
WHERE u.calendly_access_token = 'migrated_connected'
  AND NOT EXISTS (
    SELECT 1 FROM calendar_settings cs WHERE cs.user_id = u.id
  )
ON CONFLICT (user_id) DO UPDATE SET calendly_enabled = true, updated_at = NOW();
