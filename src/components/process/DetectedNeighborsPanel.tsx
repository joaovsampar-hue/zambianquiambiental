/**
 * Painel de seleção dos confrontantes detectados automaticamente pelo SICAR.
 *
 * Aparece acima do mapa quando o sistema identifica polígonos vizinhos.
 * O usuário pode desmarcar imóveis que NÃO deseja listar (caso comum: imóvel
 * separado por estrada/rio, ou que já consta como confrontante por outro CAR)
 * e cadastrar em lote apenas os selecionados.
 *
 * Os já cadastrados (mesmo CAR já inserido em `process_neighbors`) aparecem
 * em destaque verde + checkbox desabilitado — evita duplicatas.
 *
 * O estado de seleção é **controlado pelo pai** para que o mapa também possa
 * marcar/desmarcar via popup nos polígonos azuis.
 */
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';

export interface DetectedNeighbor {
  car: string;
  area: number;
  municipio: string;
  uf: string;
}

interface Props {
  detected: DetectedNeighbor[];
  /** CARs que já estão cadastrados como confrontantes deste processo. */
  alreadyRegistered: Set<string>;
  /** Conjunto controlado de CARs marcados pra cadastro em lote. */
  selected: Set<string>;
  /** Substitui o conjunto inteiro (uso interno + sync com mapa). */
  onSelectedChange: (next: Set<string>) => void;
  /** Disparado quando o usuário clica em "Cadastrar selecionados". */
  onRegister: (neighbors: DetectedNeighbor[]) => Promise<void> | void;
  isRegistering?: boolean;
}

export default function DetectedNeighborsPanel({
  detected,
  alreadyRegistered,
  selected,
  onSelectedChange,
  onRegister,
  isRegistering,
}: Props) {
  const pending = useMemo(
    () => detected.filter(n => !alreadyRegistered.has(n.car)),
    [detected, alreadyRegistered],
  );
  const registered = useMemo(
    () => detected.filter(n => alreadyRegistered.has(n.car)),
    [detected, alreadyRegistered],
  );

  if (detected.length === 0) return null;

  const toggle = (car: string) => {
    const next = new Set(selected);
    if (next.has(car)) next.delete(car);
    else next.add(car);
    onSelectedChange(next);
  };

  const toggleAllPending = () => {
    const allSelected = pending.length > 0 && pending.every(n => selected.has(n.car));
    const next = new Set(selected);
    if (allSelected) {
      for (const n of pending) next.delete(n.car);
    } else {
      for (const n of pending) next.add(n.car);
    }
    onSelectedChange(next);
  };

  const handleRegister = async () => {
    const list = detected.filter(n => selected.has(n.car) && !alreadyRegistered.has(n.car));
    if (list.length === 0) return;
    await onRegister(list);
  };

  const allPendingSelected = pending.length > 0 && pending.every(n => selected.has(n.car));
  const selectedCount = pending.filter(n => selected.has(n.car)).length;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-semibold">
                {detected.length} imóvel(eis) vizinho(s) detectado(s) pelo SICAR
              </p>
              <p className="text-xs text-muted-foreground">
                Desmarque os que não devem ser listados como confrontantes e cadastre em lote.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleAllPending}
              >
                {allPendingSelected ? 'Desmarcar todos' : 'Marcar todos'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleRegister}
              disabled={selectedCount === 0 || isRegistering}
            >
              {isRegistering && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Cadastrar selecionados ({selectedCount})
            </Button>
          </div>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
          {pending.map(n => (
            <label
              key={n.car}
              className="flex items-start gap-2 p-2 rounded-md border border-border bg-background hover:bg-accent/30 cursor-pointer transition-colors"
            >
              <Checkbox
                checked={selected.has(n.car)}
                onCheckedChange={() => toggle(n.car)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs break-all leading-tight">{n.car}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {n.municipio}/{n.uf} · {n.area.toFixed(2)} ha
                </p>
              </div>
            </label>
          ))}

          {registered.map(n => (
            <div
              key={n.car}
              className="flex items-start gap-2 p-2 rounded-md border border-success/30 bg-success/10"
              title="Já cadastrado como confrontante"
            >
              <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs break-all leading-tight">{n.car}</p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  {n.municipio}/{n.uf} · {n.area.toFixed(2)} ha
                  <Badge variant="outline" className="border-success/40 text-success text-[10px] px-1.5 py-0">
                    cadastrado
                  </Badge>
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
