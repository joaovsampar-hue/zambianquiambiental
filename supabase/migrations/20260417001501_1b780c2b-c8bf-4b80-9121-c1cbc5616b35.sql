-- Sequência para numeração GEO-AAAA-NNN (reinicia logicamente por ano via trigger)
CREATE SEQUENCE IF NOT EXISTS public.process_number_seq START 1;

-- Tabela principal de processos
CREATE TABLE public.processes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_number TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  car_number TEXT,
  service_type TEXT NOT NULL DEFAULT 'georreferenciamento',
  current_stage TEXT NOT NULL DEFAULT 'identificacao',
  status TEXT NOT NULL DEFAULT 'em_andamento',
  title TEXT,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_processes_client ON public.processes(client_id);
CREATE INDEX idx_processes_property ON public.processes(property_id);
CREATE INDEX idx_processes_status ON public.processes(status);
CREATE INDEX idx_processes_last_activity ON public.processes(last_activity_at DESC);

-- Função para gerar número sequencial GEO-AAAA-NNN
CREATE OR REPLACE FUNCTION public.generate_process_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_year TEXT;
  next_seq INT;
BEGIN
  IF NEW.process_number IS NOT NULL AND NEW.process_number <> '' THEN
    RETURN NEW;
  END IF;
  current_year := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(split_part(process_number, '-', 3) AS INT)), 0) + 1
    INTO next_seq
    FROM public.processes
    WHERE process_number LIKE 'GEO-' || current_year || '-%';
  NEW.process_number := 'GEO-' || current_year || '-' || lpad(next_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_processes_number
BEFORE INSERT ON public.processes
FOR EACH ROW EXECUTE FUNCTION public.generate_process_number();

CREATE TRIGGER trg_processes_updated_at
BEFORE UPDATE ON public.processes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view processes"
  ON public.processes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert processes"
  ON public.processes FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authenticated users can update processes"
  ON public.processes FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Creator can delete processes"
  ON public.processes FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Confrontantes ricos
CREATE TABLE public.process_neighbors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_id UUID NOT NULL REFERENCES public.processes(id) ON DELETE CASCADE,
  positions TEXT[] NOT NULL DEFAULT '{}',
  neighbor_type TEXT NOT NULL DEFAULT 'pf',
  full_name TEXT,
  cpf_cnpj TEXT,
  rg TEXT,
  rg_issuer TEXT,
  birth_date DATE,
  marital_status TEXT,
  marriage_regime TEXT,
  spouse_name TEXT,
  spouse_cpf TEXT,
  spouse_rg TEXT,
  address TEXT,
  phones JSONB NOT NULL DEFAULT '[]',
  email TEXT,
  car_number TEXT,
  registration_number TEXT,
  registry_office TEXT,
  ccir_number TEXT,
  property_denomination TEXT,
  consent_status TEXT NOT NULL DEFAULT 'nao_iniciado',
  last_contact_at TIMESTAMPTZ,
  follow_up_at TIMESTAMPTZ,
  needs_title_check BOOLEAN NOT NULL DEFAULT false,
  converted_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  pdfs JSONB NOT NULL DEFAULT '[]',
  extracted_data JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_neighbors_process ON public.process_neighbors(process_id);
CREATE INDEX idx_neighbors_consent ON public.process_neighbors(consent_status);

CREATE TRIGGER trg_neighbors_updated_at
BEFORE UPDATE ON public.process_neighbors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.process_neighbors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view neighbors"
  ON public.process_neighbors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert neighbors"
  ON public.process_neighbors FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authenticated users can update neighbors"
  ON public.process_neighbors FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Creator can delete neighbors"
  ON public.process_neighbors FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Geometria do imóvel do processo (polígono, KML, coordenadas)
CREATE TABLE public.process_geometry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_id UUID NOT NULL UNIQUE REFERENCES public.processes(id) ON DELETE CASCADE,
  geojson JSONB,
  kml_raw TEXT,
  reference_lat NUMERIC,
  reference_lng NUMERIC,
  coordinates_text TEXT,
  source TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_geometry_updated_at
BEFORE UPDATE ON public.process_geometry
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.process_geometry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view geometry"
  ON public.process_geometry FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert geometry"
  ON public.process_geometry FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Authenticated users can update geometry"
  ON public.process_geometry FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Creator can delete geometry"
  ON public.process_geometry FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Vincular análises a processos (opcional)
ALTER TABLE public.analyses
  ADD COLUMN process_id UUID REFERENCES public.processes(id) ON DELETE SET NULL;

CREATE INDEX idx_analyses_process ON public.analyses(process_id);