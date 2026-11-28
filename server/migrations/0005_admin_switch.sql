-- v0.7.1 platform tenant switching and multiple tenant admins.
ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS active_org_id text REFERENCES organizations(id) ON DELETE SET NULL;
