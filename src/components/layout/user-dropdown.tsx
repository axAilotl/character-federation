'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';

interface DropdownItem {
  label: string;
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  divider?: boolean;
}

export function UserDropdown() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    router.refresh();
  };

  // Not logged in - show login button
  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-nebula/20 hover:bg-nebula/30 text-starlight transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-cosmic-teal/50 flex items-center justify-center">
          <svg className="w-4 h-4 text-starlight/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <span className="text-sm hidden sm:inline">Login</span>
      </Link>
    );
  }

  const menuItems: DropdownItem[] = [
    {
      label: 'Profile',
      href: `/user/${user.username}`,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      label: 'My Cards',
      href: '/my-cards',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      label: 'Settings',
      href: '/settings',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      divider: true,
    },
    {
      label: 'Log Out',
      onClick: handleLogout,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      ),
    },
  ];

  // Add admin link if user is admin
  if (user.isAdmin) {
    menuItems.splice(3, 0, {
      label: 'Admin Panel',
      href: '/admin',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    });
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 p-1 rounded-full transition-all',
          'hover:ring-2 hover:ring-nebula/50',
          isOpen && 'ring-2 ring-nebula'
        )}
      >
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt={user.username}
            width={32}
            height={32}
            className="rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-nebula/30 flex items-center justify-center text-sm font-medium text-starlight">
            {user.username[0].toUpperCase()}
          </div>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 py-1 rounded-lg bg-deep-space/95 backdrop-blur-lg border border-nebula/30 shadow-xl z-50">
          {/* User info header */}
          <div className="px-4 py-3 border-b border-nebula/20">
            <p className="text-sm font-medium text-starlight truncate">
              {user.displayName || user.username}
            </p>
            <p className="text-xs text-starlight/60 truncate">@{user.username}</p>
            {user.isAdmin && (
              <span className="inline-block mt-1 px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                Admin
              </span>
            )}
          </div>

          {/* Menu items */}
          <div className="py-1">
            {menuItems.map((item) => (
              <div key={item.label}>
                {item.href ? (
                  <Link
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 px-4 py-2 text-sm text-starlight/80 hover:bg-nebula/20 hover:text-starlight transition-colors"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ) : (
                  <button
                    onClick={item.onClick}
                    className="flex items-center gap-3 w-full px-4 py-2 text-sm text-starlight/80 hover:bg-nebula/20 hover:text-starlight transition-colors"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                )}
                {item.divider && <div className="my-1 border-t border-nebula/20" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
