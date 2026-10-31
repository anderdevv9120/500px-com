CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_media_album ON media(album_id, created_at);
CREATE INDEX idx_media_ip ON media(ip_hash, created_at);
CREATE INDEX idx_media_created ON media(created_at);
