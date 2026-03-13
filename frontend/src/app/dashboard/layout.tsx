'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, CreditCard, Settings, LayoutDashboard, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { useRouter } from 'next/navigation';

const navItems = [
  { href: '/dashboard',           label: 'Overview',   icon: LayoutDashboard },
  { href: '/dashboard/documents', label: 'Documents',  icon: FileText },
  { href: '/dashboard/billing',   label: 'Billing',    icon: CreditCard },
  { href: '/dashboard/settings',  label: 'Settings',   icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const rt = localStorage.getItem('refresh_token') || '';
    await logout(rt);
    router.push('/auth/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <span className="text-xl font-bold text-blue-600">DocuParse AI</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                }`}>
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-100">
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 w-full text-sm text-slate-500 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50">
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
