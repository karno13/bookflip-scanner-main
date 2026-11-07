-- Photo of the listing as shown by the marketplace (first image). Used only for display and
-- visual verification of the edition; never as identification evidence.
ALTER TABLE offers ADD COLUMN image_url TEXT CHECK (image_url IS NULL OR (length(image_url) <= 1000 AND image_url LIKE 'https://%'));
