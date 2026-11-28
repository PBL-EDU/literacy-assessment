-- v0.7.0 multi-tenant foundation.
-- Each admin account is still bound to exactly one organization (tenant).
-- Platform admins may create new tenants and their first tenant admin.
-- All tenant data remains isolated by org_id in existing tables.

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- The first admin created by bootstrap becomes the platform administrator.
UPDATE admin_users
SET is_platform_admin = true
WHERE id = (
  SELECT id FROM admin_users ORDER BY created_at ASC, id ASC LIMIT 1
);
