-- Seconds into a video to show as its thumbnail (cover frame). 0 = first frame; images keep 0.
ALTER TABLE media ADD COLUMN poster_time REAL NOT NULL DEFAULT 0;
