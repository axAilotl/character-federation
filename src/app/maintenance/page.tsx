'use client';

import { useEffect, useState } from 'react';
import { getMaintenanceMode, type MaintenanceSettings } from '@/lib/maintenance';

export default function MaintenancePage() {
  const [settings, setSettings] = useState<MaintenanceSettings>({
    enabled: true,
    message: 'Site is currently under maintenance. Please check back soon.',
  });

  useEffect(() => {
    // Client-side check (in case user navigated directly)
    getMaintenanceMode().then(setSettings);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-deep-space p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-nebula/20 flex items-center justify-center">
            <svg
              className="w-12 h-12 text-nebula"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold gradient-text">
          Under Maintenance
        </h1>

        {/* Message */}
        <p className="text-starlight/70 text-lg">
          {settings.message}
        </p>

        {/* Additional info */}
        <div className="glass rounded-lg p-4 text-sm text-starlight/60">
          We&apos;re currently performing scheduled maintenance to improve your experience.
          Thank you for your patience!
        </div>

        {/* Refresh button */}
        <button
          onClick={() => window.location.reload()}
          className="btn-primary px-6 py-3"
        >
          Check Again
        </button>
      </div>
    </div>
  );
}
