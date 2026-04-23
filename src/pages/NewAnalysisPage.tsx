import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { deduplicateConjuges } from './AnalysisPage';
import * as pdfjsLib from 'pdfjs-dist';
// Use a CDN worker matching the installed pdfjs-dist version (avoids bundling issues).
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

async function rasterizePdfToJpegs(file: File, scale = 1.5, quality = 0.85): Promise<Blob[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const blobs: Blob[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
    );
    blobs.push(blob);
    page.cleanup();
  }
  return blobs;
}

export default function NewAnalysisPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const processId = searchParams.get('processId');
  const presetPropertyId = searchParams.get('propertyId') ?? '';
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState(presetPropertyId);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');

  useEffect(() => {
    if (!processId) return;
    supabase.from('processes').select('client_id, property_id').eq('id', processId).single()
      .then(({ data }) => {
        if (data) {
          setClientId(data.client_id);
          if (data.property_id) setPropertyId(data.property_id);
        }
      });
  }, [processId]);

  const { data: clients } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: properties } = useQuery({
    queryKey: ['properties-list', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase.from('properties').select('id, denomination').eq('client_id', clientId).order('denomination');
      return data ?? [];
    },
  });

  const processMatricula = async (file: File, analysisId: string, version: number) => {
    // Step 1: Upload original PDF
    const ts = Date.now();
    const filePath = `${user!.id}/${ts}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from('matriculas').upload(filePath, file);
    if (uploadError) throw uploadError;

    // Step 1b: Rasterize PDF to JPEGs
    const pageBlobs = await rasterizePdfToJpegs(file);
    const pagesPrefix = `${user!.id}/${ts}_pages`;
    const imagePaths: string[] = [];
    for (let i = 0; i < pageBlobs.length; i++) {
      const path = `${pagesPrefix}/page-${String(i + 1).padStart(3, '0')}.jpg`;
      const { error: pErr } = await supabase.storage
        .from('matriculas')
        .upload(path, pageBlobs[i], { contentType: 'image/jpeg' });
      if (pErr) throw pErr;
      imagePaths.push(path);
    }

    // Step 2: Extract text from PDF
    const { data: funcData, error: funcError } = await supabase.functions.invoke('process-matricula', {
      body: { analysisId, pdfPath: filePath, imagePaths },
    });
    if (funcError) throw funcError;

    const extracted_data = funcData.extracted_data;
    if (extracted_data?.owners) {
      extracted_data.owners = deduplicateConjuges(extracted_data.owners);
    }

    return { 
      pdf_name: file.name, 
      extracted_data: extracted_data || {}, 
      alerts: funcData.alerts || [],
      status: extracted_data?.identification?.registration_number ? 'completed' : 'empty'
    };
  };

  const propagateDeaths = (matriculasData: any[]) => {
    // Coleta todos os falecidos detectados em qualquer matrícula
    const deceasedNames = new Set<string>();
    matriculasData.forEach(m => {
      (m.alerts ?? []).forEach((a: any) => {
        if (a.message?.includes('[FALECIMENTO]')) {
          const match = a.message.match(
            /proprietári[oa]\s+([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇa-záéíóúâêîôûãõç\s]+?)\s+consta/i
          );
          if (match?.[1]) deceasedNames.add(match[1].trim().toUpperCase());
        }
      });
    });

    if (deceasedNames.size === 0) return matriculasData;

    return matriculasData.map(m => {
      const regNum = m.extracted_data?.identification?.registration_number ?? 'desconhecida';
      const newOwners: any[] = [];
      const newAlerts = [...(m.alerts ?? [])];
      let changed = false;

      for (const o of (m.extracted_data?.owners ?? [])) {
        const ownerUpper = (o.name ?? '').toUpperCase().trim();
        const isDead = [...deceasedNames].some(dead => {
          const deadWords = dead.split(/\s+/);
          // Pelo menos 2 palavras em comum (evita falsos positivos com nomes curtos)
          const matches = deadWords.filter(w => w.length > 3 && ownerUpper.includes(w));
          return matches.length >= 2;
        });

        if (isDead) {
          changed = true;
          const alreadyHasAlert = newAlerts.some(a =>
            a.message?.includes('[FALECIMENTO]') && a.message?.includes(o.name)
          );
          if (!alreadyHasAlert) {
            newAlerts.push({
              severity: 'critical',
              message: `[FALECIMENTO DETECTADO EM OUTRA MATRÍCULA] ${o.name} consta como falecido em outra matrícula do mesmo imóvel. Removido dos proprietários ativos da matrícula ${regNum}.`,
            });
            if (o.share_percentage) {
              newAlerts.push({
                severity: 'critical',
                message: `[ESPÓLIO PENDENTE] A fração de ${o.share_percentage} pertencente a ${o.name} na matrícula ${regNum} pode requerer verificação de inventário.`,
              });
            }
          }
        } else {
          newOwners.push(o);
        }
      }

      if (!changed) return m;
      return {
        ...m,
        alerts: newAlerts,
        extracted_data: { ...m.extracted_data, owners: newOwners },
      };
    });
  };

  const processAnalysis = useMutation({
    mutationFn: async () => {
      if (files.length === 0 || !propertyId) throw new Error('Selecione um imóvel e pelo menos um arquivo');

      // 1. Get existing version count
      const { count } = await supabase
        .from('analyses')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', propertyId);
      const version = (count ?? 0) + 1;

      // 2. Create initial analysis record
      setStep('Criando registro da análise...');
      setProgress(5);
      const { data: analysis, error: insertError } = await supabase
        .from('analyses')
        .insert({
          property_id: propertyId,
          created_by: user!.id,
          status: 'processing',
          version,
          process_id: processId ?? null,
        } as any)
        .select('id')
        .single();
      if (insertError) throw insertError;
      setProgress(10);

      // 3. Process all files in parallel
      setStep(`Analisando ${files.length} matrícula(s) em paralelo...`);
      const results = await Promise.allSettled(
        files.map(file => processMatricula(file, analysis.id, version))
      );
      
      const matriculasData = results.map((r, i) => {
        const file = files[i];
        if (r.status === 'rejected') {
          console.error(`Análise falhou para ${file.name}:`, r.reason);
          return {
            pdf_name: file.name,
            extracted_data: { identification: {}, owners: [], boundaries: {}, encumbrances: {}, transfers: [] },
            alerts: [{
              severity: 'critical',
              message: `Falha na análise do arquivo ${file.name}: ${r.reason?.message ?? 'Erro desconhecido'}`
            }],
            status: 'error',
            error: r.reason?.message ?? 'Erro desconhecido',
          };
        }
        const result = r.value;
        if (!result?.extracted_data || Object.keys(result.extracted_data).length === 0) {
          console.warn(`Análise de ${file.name} retornou dados vazios`);
        }
        return {
          pdf_name: file.name,
          extracted_data: result?.extracted_data ?? {
            identification: {}, owners: [], boundaries: {},
            encumbrances: {}, transfers: []
          },
          alerts: result?.alerts ?? [],
          status: result?.extracted_data?.identification?.registration_number
            ? 'completed' : 'empty',
        };
      });

      const matriculasDataFinal = propagateDeaths(matriculasData);

      // 4. Update analysis with consolidated results
      setStep('Salvando resultados consolidados...');
      const { error: updateError } = await supabase
        .from('analyses')
        .update({
          extracted_data: { 
            matriculas_data: matriculasDataFinal,
            // Fallback para campos individuais usando a primeira matrícula de sucesso
            ...(matriculasDataFinal.find(m => m.status === 'completed')?.extracted_data || {})
          },
          alerts: matriculasDataFinal.flatMap(m => m.alerts),
          status: 'completed',
        })
        .eq('id', analysis.id);
      if (updateError) throw updateError;
      setProgress(100);

      return analysis.id;
    },
    onSuccess: (analysisId) => {
      toast({ title: 'Análise concluída!' });
      navigate(`/analysis/${analysisId}`);
    },
    onError: (e: any) => {
      toast({ title: 'Erro no processamento', description: e.message, variant: 'destructive' });
      setStep('');
      setProgress(0);
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (droppedFiles.length > 0) setFiles(prev => [...prev, ...droppedFiles]);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-heading font-bold">Nova Análise</h1>
        <p className="text-muted-foreground text-sm">Upload de matrícula(s) para extração automática consolidada</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={clientId} onValueChange={v => { setClientId(v); setPropertyId(''); }}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Imóvel *</Label>
              <Select value={propertyId} onValueChange={setPropertyId} disabled={!clientId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {properties?.map(p => <SelectItem key={p.id} value={p.id}>{p.denomination}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => document.getElementById('pdf-input')?.click()}
            className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            <input
              id="pdf-input"
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={e => {
                const selectedFiles = Array.from(e.target.files ?? []).filter(f => f.type === 'application/pdf');
                if (selectedFiles.length > 0) setFiles(prev => [...prev, ...selectedFiles]);
              }}
            />
            {files.length > 0 ? (
              <div className="space-y-3">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-center gap-3">
                    <FileText className="w-6 h-6 text-primary" />
                    <div className="text-left">
                      <p className="font-medium text-sm">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-primary font-medium mt-2">+ Clique ou arraste para adicionar mais</p>
              </div>
            ) : (
              <div>
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Arraste os PDFs aqui ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground mt-1">Selecione uma ou mais matrículas para análise conjunta</p>
              </div>
            )}
          </div>

          {processAnalysis.isPending && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{step}</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          <Button
            className="w-full"
            disabled={files.length === 0 || !propertyId || processAnalysis.isPending}
            onClick={() => processAnalysis.mutate()}
          >
            {processAnalysis.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando {files.length} arquivos...</>
            ) : (
              `Iniciar Análise (${files.length} arquivo${files.length !== 1 ? 's' : ''})`
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
