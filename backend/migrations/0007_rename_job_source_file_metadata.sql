ALTER TABLE jobs RENAME COLUMN image_r2_key TO source_file_key;
ALTER TABLE jobs RENAME COLUMN image_mime_type TO source_mime_type;
ALTER TABLE jobs RENAME COLUMN image_name TO source_name;
