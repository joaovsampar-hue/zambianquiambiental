-- ============================================================
-- 1. Tighten UPDATE/DELETE policies to record creators only
-- ============================================================

-- clients
DROP POLICY IF EXISTS "Authenticated users can update clients" ON public.clients;
CREATE POLICY "Creator can update clients"
  ON public.clients FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- properties
DROP POLICY IF EXISTS "Authenticated users can update properties" ON public.properties;
CREATE POLICY "Creator can update properties"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- processes
DROP POLICY IF EXISTS "Authenticated users can update processes" ON public.processes;
CREATE POLICY "Creator can update processes"
  ON public.processes FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- analyses
DROP POLICY IF EXISTS "Authenticated users can update analyses" ON public.analyses;
CREATE POLICY "Creator can update analyses"
  ON public.analyses FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- process_geometry
DROP POLICY IF EXISTS "Authenticated users can update geometry" ON public.process_geometry;
CREATE POLICY "Creator can update geometry"
  ON public.process_geometry FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- process_neighbors
DROP POLICY IF EXISTS "Authenticated users can update neighbors" ON public.process_neighbors;
CREATE POLICY "Creator can update neighbors"
  ON public.process_neighbors FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- company_settings: company-level config — restrict writes to authenticated, no destructive change since DELETE not allowed
-- (already fine; UPDATE is intentionally allowed by any authenticated user since this is shared company config)

-- ============================================================
-- 2. Create private 'signatures' bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can read signatures (used for PDF embedding via signed URLs)
CREATE POLICY "Authenticated read signatures"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'signatures');

-- Each user can only manage their own signature: path must start with `<user_id>/`
CREATE POLICY "User can upload own signature"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "User can update own signature"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'signatures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "User can delete own signature"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'signatures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- 3. Storage hygiene
-- ============================================================

-- Matriculas: add UPDATE policy (private bucket, only authenticated)
CREATE POLICY "Authenticated update matriculas"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'matriculas');

-- snci-data: add write policies (public bucket but restrict writes to authenticated)
CREATE POLICY "Authenticated insert snci-data"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'snci-data');

CREATE POLICY "Authenticated update snci-data"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'snci-data');

CREATE POLICY "Authenticated delete snci-data"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'snci-data');
