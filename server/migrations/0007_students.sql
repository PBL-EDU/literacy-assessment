-- v0.9.0 student directory and cross-mentor structured summaries.
-- Raw evidence, recordings, photos and report bodies are not stored here.

CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id text REFERENCES teams(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, team_id, name)
);

CREATE INDEX IF NOT EXISTS students_org_team_idx ON students (org_id, team_id, status);

CREATE TABLE IF NOT EXISTS student_summaries (
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  current_levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  activity_count integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  summary text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, member_id)
);

CREATE INDEX IF NOT EXISTS student_summaries_member_idx ON student_summaries (member_id, updated_at DESC);
