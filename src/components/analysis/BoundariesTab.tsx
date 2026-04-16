import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Bot, Upload, Loader2, Trash2, MapPin, FileText, User, Building } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface NeighborPdf {
  file_name: string;
  pdf_path: string;
  extracted_data?: any;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error_message?: string;
}

interface NeighborProperty {
  registration_number: string;
  denomination: string;
  municipality: string;
  state: string;
  total_area: string;
  owners: { name: string; cpf_cnpj: string }[];
  pdfs: NeighborPdf[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error_message?: string;
}

interface BoundariesTabProps {
  formData: any;
  updateField: (path: string, value: any) => void;
  getField: (path: string) => string;
}

export default function BoundariesTab({ formData, updateField, getField }: BoundariesTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  const roteiro = getField('boundaries.roteiro') || '';
  const neighbors: NeighborProperty[] = formData?.boundaries?.neighbors ?? [];

  const updateNeighbors = (newNeighbors: NeighborProperty[]) => {
    updateField('boundaries.neighbors', newNeighbors);
  };

  const addNeighbor = () => {
    updateNeighbors([
      ...neighbors,
      {
        registration_number: '',
        denomination: '',
        municipality: '',
        state: '',
        total_area: '',
        owners: [],
        pdfs: [],
        status: 'pending',
      },
    ]);
  };

  const removeNeighbor = (index: number) => {
    updateNeighbors(neighbors.filter((_, i) => i !== index));
  };

  const updateNeighborField = (index: number, field: string, value: any) => {
    const updated = [...neighbors];
    updated[index] = { ...updated[index], [field]: value };
    updateNeighbors(updated);
  };

  const processNeighborPdf = async (index: number, file: File) => {
    if (!user) return;
    setProcessingIndex(index);
    setProgress(10);

    try {
      // Upload PDF
      const filePath = `${user.id}/neighbor_${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('matriculas').upload(filePath, file);
      if (uploadError) throw uploadError;
      setProgress(30);

      updateNeighborField(index, 'status', 'processing');

      // Process with AI
      setProgress(50);
      const { data: funcData, error: funcError } = await supabase.functions.invoke('process-matricula', {
        body: { analysisId: null, pdfPath: filePath },
      });

      if (funcError) throw funcError;
      setProgress(90);

      const extracted = funcData.extracted_data;
      const ident = extracted?.identification ?? {};
      const owners = (extracted?.owners ?? []).map((o: any) => ({
        name: o.name || '',
        cpf_cnpj: o.cpf_cnpj || '',
      }));

      const updated = [...neighbors];
      updated[index] = {
        ...updated[index],
        denomination: ident.denomination || '',
        municipality: ident.municipality || '',
        state: ident.state || '',
        total_area: ident.total_area || '',
        registration_number: ident.registration_number || updated[index].registration_number,
        owners,
        status: 'completed',
      };
      updateNeighbors(updated);
      setProgress(100);

      toast({ title: `Confrontante ${index + 1} analisado com sucesso!` });
    } catch (e: any) {
      updateNeighborField(index, 'status', 'error');
      updateNeighborField(index, 'error_message', e.message);
      toast({ title: 'Erro ao processar confrontante', description: e.message, variant: 'destructive' });
    } finally {
      setProcessingIndex(null);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-6">
      {/* Roteiro completo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Roteiro da Matrícula
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Descrição perimétrica completa</Label>
              {roteiro && <span title="Preenchido pela IA"><Bot className="w-3 h-3 text-primary" /></span>}
            </div>
            <Textarea
              value={roteiro}
              onChange={e => updateField('boundaries.roteiro', e.target.value)}
              className="text-sm min-h-[160px] font-mono leading-relaxed"
              placeholder="O roteiro completo da matrícula será extraído automaticamente pela IA..."
              rows={8}
            />
          </div>
        </CardContent>
      </Card>

      {/* Confrontantes */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" />
              Imóveis Confrontantes ({neighbors.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={addNeighbor}>
              + Adicionar Confrontante
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Faça upload das matrículas dos imóveis confrontantes para extrair automaticamente os dados atualizados
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {neighbors.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Building className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum confrontante cadastrado</p>
              <p className="text-xs mt-1">Clique em "Adicionar Confrontante" para inserir as matrículas vizinhas</p>
            </div>
          )}

          {neighbors.map((neighbor, i) => (
            <div key={i} className="border border-border rounded-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5">
                <span className="text-sm font-semibold text-primary">Confrontante {i + 1}</span>
                <div className="flex items-center gap-2">
                  {neighbor.status === 'completed' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      ✓ Analisado
                    </span>
                  )}
                  {neighbor.status === 'error' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                      Erro
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeNeighbor(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Registration number + upload */}
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Nº da Matrícula</Label>
                    <Input
                      value={neighbor.registration_number}
                      onChange={e => updateNeighborField(i, 'registration_number', e.target.value)}
                      placeholder="Ex: 12345"
                      className="text-sm h-9"
                    />
                  </div>
                  <div>
                    <input
                      id={`neighbor-pdf-${i}`}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) processNeighborPdf(i, f);
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-9"
                      disabled={processingIndex !== null}
                      onClick={() => document.getElementById(`neighbor-pdf-${i}`)?.click()}
                    >
                      {processingIndex === i ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analisando...</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5 mr-1.5" />Upload Matrícula</>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Progress bar when processing */}
                {processingIndex === i && (
                  <div className="space-y-1">
                    <Progress value={progress} className="h-1.5" />
                    <p className="text-xs text-muted-foreground">Processando matrícula com IA...</p>
                  </div>
                )}

                {/* Error message */}
                {neighbor.status === 'error' && neighbor.error_message && (
                  <p className="text-xs text-destructive">{neighbor.error_message}</p>
                )}

                {/* Extracted data (only show if completed or manually filled) */}
                {(neighbor.status === 'completed' || neighbor.denomination) && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Denominação</Label>
                        <Input
                          value={neighbor.denomination}
                          onChange={e => updateNeighborField(i, 'denomination', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Área Total (ha)</Label>
                        <Input
                          value={neighbor.total_area}
                          onChange={e => updateNeighborField(i, 'total_area', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Município</Label>
                        <Input
                          value={neighbor.municipality}
                          onChange={e => updateNeighborField(i, 'municipality', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">UF</Label>
                        <Input
                          value={neighbor.state}
                          onChange={e => updateNeighborField(i, 'state', e.target.value)}
                          className="text-sm h-9"
                        />
                      </div>
                    </div>

                    {/* Owners */}
                    {neighbor.owners.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold flex items-center gap-1.5">
                          <User className="w-3 h-3" /> Proprietários Atuais
                        </Label>
                        {neighbor.owners.map((owner, oi) => (
                          <div key={oi} className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-primary/20">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Nome</Label>
                              <Input
                                value={owner.name}
                                onChange={e => {
                                  const updatedOwners = [...neighbor.owners];
                                  updatedOwners[oi] = { ...updatedOwners[oi], name: e.target.value };
                                  updateNeighborField(i, 'owners', updatedOwners);
                                }}
                                className="text-sm h-8"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">CPF/CNPJ</Label>
                              <Input
                                value={owner.cpf_cnpj}
                                onChange={e => {
                                  const updatedOwners = [...neighbor.owners];
                                  updatedOwners[oi] = { ...updatedOwners[oi], cpf_cnpj: e.target.value };
                                  updateNeighborField(i, 'owners', updatedOwners);
                                }}
                                className="text-sm h-8"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
