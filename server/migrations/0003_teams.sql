-- v0.6.1 teacher identity, teams and tenant naming.
-- Additive migration: existing members/invites remain valid.

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teams_org_idx ON teams (org_id, status, name);

ALTER TABLE members ADD COLUMN IF NOT EXISTS team_id text REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS team_name text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS teacher_no text;

ALTER TABLE invites ADD COLUMN IF NOT EXISTS member_id text REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS teacher_name text;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS team_id text REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS team_name text;

CREATE INDEX IF NOT EXISTS invites_member_idx ON invites (member_id);

-- First tenant: the organization that owns this deployment.
UPDATE organizations
SET name = '西部阳光基金会', updated_at = now()
WHERE name = '白日梦行动';
