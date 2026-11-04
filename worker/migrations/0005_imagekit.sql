-- Start uploads afresh; accounts, sessions and seeded-photo overrides stay intact.
-- Old R2 objects remain in the bucket and are not migrated or deleted.
DELETE FROM media;
DELETE FROM albums;
ALTER TABLE media RENAME COLUMN r2_key TO imagekit_file_id;
ALTER TABLE media ADD COLUMN url TEXT NOT NULL DEFAULT '';
