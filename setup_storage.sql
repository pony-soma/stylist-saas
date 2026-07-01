-- 1. Create the storage bucket for medical record photos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('record-photos', 'record-photos', true) 
ON CONFLICT (id) DO NOTHING;

-- 2. Set up Storage Object Policies
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'record-photos');

DROP POLICY IF EXISTS "Stylists can upload photos" ON storage.objects;
CREATE POLICY "Stylists can upload photos" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'record-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Stylists can update photos" ON storage.objects;
CREATE POLICY "Stylists can update photos" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'record-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Stylists can delete photos" ON storage.objects;
CREATE POLICY "Stylists can delete photos" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'record-photos' AND auth.role() = 'authenticated');

-- 3. Fix the RLS Policy for the record_photos table
DROP POLICY IF EXISTS "Stylists can manage record photos" ON record_photos;

CREATE POLICY "Stylists can manage record photos" ON record_photos
  FOR ALL USING (
    auth.role() = 'authenticated'
  );
