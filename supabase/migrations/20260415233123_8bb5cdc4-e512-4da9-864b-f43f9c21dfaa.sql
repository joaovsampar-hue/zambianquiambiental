
-- Fix: restrict UPDATE policies to only authenticated users with explicit check
DROP POLICY "Authenticated users can update clients" ON public.clients;
CREATE POLICY "Authenticated users can update clients" ON public.clients FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY "Authenticated users can update properties" ON public.properties;
CREATE POLICY "Authenticated users can update properties" ON public.properties FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY "Authenticated users can update analyses" ON public.analyses;
CREATE POLICY "Authenticated users can update analyses" ON public.analyses FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
