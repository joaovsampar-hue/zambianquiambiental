import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Loader2 } from 'lucide-react';

export default function NewAnalysisPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');

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

  const processAnalysis = useMutation({
    mutationFn: async () => {
      if (!file || !propertyId) throw new Error('Selecione um imóvel e um arquivo');

      // Step 1: Upload PDF
      setStep('Enviando PDF...');
      setProgress(10);
      const filePath = `${user!.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('matriculas').upload(filePath, file);
      if (uploadError) throw uploadError;
      setProgress(30);

      // Step 2: Get existing version count
      const { count } = await supabase
        .from('analyses')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', propertyId);
      const version = (count ?? 0) + 1;

      // Step 3: Create analysis record
      setStep('Criando registro da análise...');
      const { data: analysis, error: insertError } = await supabase
        .from('analyses')
        .insert({
          property_id: propertyId,
          created_by: user!.id,
          pdf_path: filePath,
          status: 'processing',
          version,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      setProgress(40);

      // Step 4: Extract text from PDF (send to edge function)
      setStep('Processando com IA...');
      setProgress(50);

      const { data: funcData, error: funcError } = await supabase.functions.invoke('process-matricula', {
        body: { analysisId: analysis.id, pdfPath: filePath },
      });

      if (funcError) throw funcError;
      setProgress(90);

      // Step 5: Update analysis with results
      setStep('Salvando resultados...');
      const { error: updateError } = await supabase
        .from('analyses')
        .update({
          extracted_data: funcData.extracted_data,
          alerts: funcData.alerts,
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
    const f = e.dataTransfer.files[0];
    if (f?.type === 'application/pdf') setFile(f);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-heading font-bold">Nova Análise</h1>
        <p className="text-muted-foreground text-sm">Upload de matrícula para extração automática</p>
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
              className="hidden"
              onChange={e => e.target.files?.[0] && setFile(e.target.files[0])}
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
            ) : (
              <div>
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Arraste o PDF aqui ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground mt-1">PDF escaneado ou com texto selecionável · Até 30 páginas</p>
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
            disabled={!file || !propertyId || processAnalysis.isPending}
            onClick={() => processAnalysis.mutate()}
          >
            {processAnalysis.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando...</>
            ) : (
              'Iniciar Análise'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
