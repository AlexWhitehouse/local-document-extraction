ALTER TABLE user ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE user ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason TEXT;
ALTER TABLE user ADD COLUMN banExpires TEXT;

ALTER TABLE session ADD COLUMN impersonatedBy TEXT;

UPDATE user
SET role = 'user'
WHERE role IS NULL OR role = '';

UPDATE user
SET role = 'admin'
WHERE id IN (
  'BQ9gkpXoEQqllOHHK2128xmB9yxrNtCS',
  'CgsV4Bzh0pBcHekCNCxuYt6jQTMtSwFu'
);
