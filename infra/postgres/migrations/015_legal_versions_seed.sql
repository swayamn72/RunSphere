-- Seed the versioned legal-document catalog (011). Consent and audit records
-- reference these exact (kind, version) pairs. URLs point at the published
-- documents; they are replaced at rollout with the hosted copies.
INSERT INTO legal_versions (kind, version, effective_at, url) VALUES
  ('terms', 1, now(), 'https://runsphere.app/legal/terms/v1'),
  ('privacy', 1, now(), 'https://runsphere.app/legal/privacy/v1'),
  ('community', 1, now(), 'https://runsphere.app/legal/community/v1'),
  ('competition_rules', 1, now(), 'https://runsphere.app/legal/competition-rules/v1')
ON CONFLICT (kind, version) DO NOTHING;
