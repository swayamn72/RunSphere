-- Seed the role catalog introduced by 011 so role assignments can be granted
-- immediately. Idempotent; new roles added in later phases use the same pattern.
INSERT INTO staff_roles (role) VALUES
  ('admin'),
  ('data_steward'),
  ('moderator'),
  ('privacy_officer'),
  ('campaign_manager'),
  ('season_operator'),
  ('support')
ON CONFLICT (role) DO NOTHING;
