'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { useSettings } from '@/lib/settings';

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    name: 'Home',
    href: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    name: 'Explore',
    href: '/explore',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    name: 'Feed',
    href: '/feed',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    name: 'Upload',
    href: '/upload',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
];

const secondaryNavItems: NavItem[] = [
  {
    name: 'Favorites',
    href: '/favorites',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { settings, updateSettings } = useSettings();
  const isExpanded = settings.sidebarExpanded;

  const toggleExpanded = () => {
    updateSettings({ sidebarExpanded: !isExpanded });
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen pt-16 lg:translate-x-0',
          'bg-deep-space/95 backdrop-blur-lg border-r border-nebula/20',
          'transition-all duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          isExpanded ? 'w-64' : 'w-16'
        )}
      >
        <div className="flex flex-col h-full px-3 py-4 overflow-hidden">
          {/* Main navigation */}
          <nav className="flex-1 space-y-1">
            <div className={cn(
              'text-xs font-semibold text-starlight/50 uppercase tracking-wider px-3 mb-2 transition-all duration-300 overflow-hidden',
              isExpanded ? 'opacity-100 h-4' : 'opacity-0 h-0'
            )}>
              Navigation
            </div>
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                title={!isExpanded ? item.name : undefined}
                className={cn(
                  'flex items-center rounded-lg transition-all duration-200 overflow-hidden',
                  isExpanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-2 py-2.5',
                  pathname === item.href
                    ? 'bg-nebula/20 text-nebula'
                    : 'text-starlight/70 hover:bg-cosmic-teal/30 hover:text-starlight'
                )}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span className={cn(
                  'whitespace-nowrap transition-all duration-300',
                  isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'
                )}>
                  {item.name}
                </span>
              </Link>
            ))}

            <div className={cn(
              'text-xs font-semibold text-starlight/50 uppercase tracking-wider px-3 mt-6 mb-2 transition-all duration-300 overflow-hidden',
              isExpanded ? 'opacity-100 h-4' : 'opacity-0 h-0 mt-4'
            )}>
              Library
            </div>
            {secondaryNavItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                title={!isExpanded ? item.name : undefined}
                className={cn(
                  'flex items-center rounded-lg transition-all duration-200 overflow-hidden',
                  isExpanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-2 py-2.5',
                  !isExpanded && item.name === 'Favorites' && 'mt-4',
                  pathname === item.href
                    ? 'bg-nebula/20 text-nebula'
                    : 'text-starlight/70 hover:bg-cosmic-teal/30 hover:text-starlight'
                )}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                <span className={cn(
                  'whitespace-nowrap transition-all duration-300',
                  isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'
                )}>
                  {item.name}
                </span>
              </Link>
            ))}
          </nav>

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={toggleExpanded}
            className={cn(
              'hidden lg:flex items-center rounded-lg text-starlight/50 hover:text-starlight hover:bg-cosmic-teal/30 transition-all duration-200 overflow-hidden',
              isExpanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-2 py-2.5'
            )}
            title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg
              className={cn('w-5 h-5 flex-shrink-0 transition-transform duration-300', !isExpanded && 'rotate-180')}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            <span className={cn(
              'whitespace-nowrap transition-all duration-300',
              isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'
            )}>
              Collapse
            </span>
          </button>

          {/* Footer */}
          <div className={cn(
            'pt-4 border-t border-nebula/20 transition-all duration-300 overflow-hidden',
            isExpanded ? 'opacity-100' : 'opacity-0 h-0 pt-0 border-0'
          )}>
            <div className="px-3 text-xs text-starlight/40">
              <div>CardsHub</div>
              <div>Character Card Platform</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
