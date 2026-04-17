import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export default function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 overflow-x-auto">
      <Link to="/" className="flex items-center hover:text-foreground transition-colors">
        <Home className="w-3.5 h-3.5" />
      </Link>
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5 whitespace-nowrap">
          <ChevronRight className="w-3.5 h-3.5" />
          {c.to ? (
            <Link to={c.to} className="hover:text-foreground transition-colors">{c.label}</Link>
          ) : (
            <span className="text-foreground font-medium">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
