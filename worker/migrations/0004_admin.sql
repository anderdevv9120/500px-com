ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
CREATE UNIQUE INDEX one_admin ON users(is_admin) WHERE is_admin = 1;
ALTER TABLE media ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- Reserve the requested account, replace its password and revoke any older sessions.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = 'quyenday');
INSERT INTO users (id, username, password, created_at, is_admin)
VALUES ('trust-web-admin', 'quyenday', '50000:153d9c7f575d6cfb708525998df18c2c:ec19155c4fb3ebf2d1946adf20acaddff81606e7ffb726c232d3375d389608bb', unixepoch() * 1000, 1)
ON CONFLICT(username) DO UPDATE SET password = excluded.password, is_admin = 1;

CREATE TABLE photo_overrides (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  created_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);
