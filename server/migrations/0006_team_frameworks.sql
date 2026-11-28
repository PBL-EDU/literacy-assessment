-- v0.8.0 team leads and team-scoped frameworks.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS lead_member_id text REFERENCES members(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS team_framework_versions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  framework_id text NOT NULL,
  name text NOT NULL,
  version text NOT NULL,
  file_hash text NOT NULL,
  markdown text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'disabled')),
  published_by text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, framework_id, version)
);

CREATE INDEX IF NOT EXISTS team_framework_team_idx
  ON team_framework_versions (team_id, status, framework_id, published_at DESC);
