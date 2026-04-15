import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Users, PlusCircle, History, Leaf, LogOut } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clients', icon: Users, label: 'Clientes' },
  { to: '/new-analysis', icon: PlusCircle, label: 'Nova Análise' },
  { to: '/history', icon: History, label: 'Histórico' },
];

export default function AppSidebar() {
  const { signOut, user } = useAuth();
  const location = useLocation();

  return (
    <aside className="w-64 min-h-screen bg-sidebar flex flex-col border-r border-sidebar-border">
      <div className="p-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-sidebar-primary/20 flex items-center justify-center">
          <Leaf className="w-5 h-5 text-sidebar-primary" />
        </div>
        <div>
          <h2 className="text-sm font-heading font-bold text-sidebar-foreground">Zambianqui</h2>
          <p className="text-xs text-sidebar-foreground/60">Geo Análise</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar-item ${isActive ? 'active' : 'text-sidebar-foreground/70'}`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="px-3 py-2 text-xs text-sidebar-foreground/50 truncate">
          {user?.email}
        </div>
        <button
          onClick={signOut}
          className="sidebar-item w-full text-sidebar-foreground/70 hover:text-destructive"
        >
          <LogOut className="w-5 h-5" />
          Sair
        </button>
      </div>
    </aside>
  );
}
