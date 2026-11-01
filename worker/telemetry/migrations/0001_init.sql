-- GATEFIT-H25 collector schema. Aggregates only. '' instead of NULL so the primary
-- key deduplicates. counts has no install column, so an install cannot be linked to
-- the commands it ran; installs holds a 16-hex SHA-256 prefix per day for distinct counts.
CREATE TABLE counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cli', 'site')),
  command TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  node TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  arch TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  pack TEXT NOT NULL DEFAULT '',
  suite TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, command, version, node, platform, arch, outcome, template, pack, suite, event)
);

CREATE TABLE installs (
  day TEXT NOT NULL,
  install_hash TEXT NOT NULL,
  PRIMARY KEY (day, install_hash)
);
