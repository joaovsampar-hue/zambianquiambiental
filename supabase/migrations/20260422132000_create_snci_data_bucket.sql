-- Criação do bucket público para armazenamento de arquivos GeoJSON do SNCI.
-- Este bucket permite download público sem autenticação para servir o mapa.

INSERT INTO storage.buckets (id, name, public)
VALUES ('snci-data', 'snci-data', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de acesso para o bucket snci-data

-- 1. Permite que qualquer pessoa (incluindo usuários não autenticados) visualize e baixe arquivos.
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'snci-data');

-- 2. Permite que usuários autenticados façam upload de novos arquivos .geojson.
CREATE POLICY "Authenticated Upload Access"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'snci-data' AND
  (LOWER(storage.extension(name)) = 'geojson')
);

-- 3. Permite que usuários autenticados atualizem ou excluam arquivos que eles mesmos enviaram (ou todos, dependendo da necessidade).
-- Para SNCI, geralmente apenas administradores ou o sistema via edge function gerenciam os dados.
-- Mantendo permissivo para autenticados para facilitar a carga inicial.
CREATE POLICY "Authenticated Manage Access"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'snci-data');
