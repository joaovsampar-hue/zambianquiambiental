import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, Loader2 } from 'lucide-react';

interface DeleteButtonProps {
  onConfirm: () => Promise<void> | void;
  title?: string;
  description?: string;
  size?: 'sm' | 'icon' | 'default';
  variant?: 'ghost' | 'outline' | 'destructive';
  label?: string;
  iconOnly?: boolean;
  className?: string;
  /** Impede que o clique propague (útil dentro de cards <Link>) */
  stopPropagation?: boolean;
}

export default function DeleteButton({
  onConfirm,
  title = 'Confirmar exclusão',
  description = 'Esta ação não pode ser desfeita.',
  size = 'sm',
  variant = 'ghost',
  label = 'Excluir',
  iconOnly = false,
  className,
  stopPropagation = true,
}: DeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant={variant}
        size={iconOnly ? 'icon' : size}
        className={`${variant === 'ghost' ? 'text-destructive hover:text-destructive hover:bg-destructive/10' : ''} ${className ?? ''}`}
        onClick={(e) => {
          if (stopPropagation) { e.preventDefault(); e.stopPropagation(); }
          setOpen(true);
        }}
      >
        <Trash2 className={iconOnly ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
        {!iconOnly && <span className="ml-1.5">{label}</span>}
      </Button>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={async (e) => {
              e.preventDefault();
              setLoading(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setLoading(false);
              }
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
