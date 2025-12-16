'use client';

/**
 * Profile Panel
 *
 * Uses AutoForm to render profile settings.
 * Values are stored via API (/api/users/me).
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AutoForm } from '@character-foundry/character-foundry/app-framework';
import { useAuth } from '@/lib/auth/context';
import { settingsRegistry, widgetRegistry } from '@/lib/settings/registry';
import { ProfileSchema, type Profile } from '@/lib/settings/schemas';
import { Input } from '@/components/ui';

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileCss: string | null;
}

export function ProfilePanel() {
  const { user, refresh } = useAuth();
  const panel = settingsRegistry.getPanel('profile');

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [formValues, setFormValues] = useState<Profile>({
    displayName: null,
    email: null,
    bio: null,
    profileCss: null,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Fetch profile on mount
  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  async function fetchProfile() {
    try {
      const res = await fetch('/api/users/me');
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setFormValues({
          displayName: data.displayName || null,
          email: data.email || null,
          bio: data.bio || null,
          profileCss: data.profileCss || null,
        });
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  }

  const handleChange = useCallback((values: Profile) => {
    setFormValues(values);
    setIsDirty(true);
    setMessage(null);
  }, []);

  const handleSubmit = useCallback(async (values: Profile) => {
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: values.displayName?.trim() || null,
          email: values.email?.trim() || null,
          bio: values.bio?.trim() || null,
          profileCss: values.profileCss?.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      const data = await res.json();
      setProfile(data);
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      setIsDirty(false);
      refresh(); // Refresh auth context
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  if (!panel) return null;

  // Not logged in
  if (!user) {
    return (
      <div data-settings-panel>
        <h2 data-settings-panel-title>{panel.title}</h2>
        <div className="text-center py-4">
          <p className="text-starlight/70 mb-3">Log in to manage your profile</p>
          <Link
            href="/login"
            className="inline-block px-4 py-2 bg-nebula hover:bg-nebula/80 text-white rounded-lg transition-colors"
          >
            Log In
          </Link>
        </div>
      </div>
    );
  }

  // Loading
  if (!profile) {
    return (
      <div data-settings-panel>
        <h2 data-settings-panel-title>{panel.title}</h2>
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-surface-2 rounded" />
          <div className="h-10 bg-surface-2 rounded" />
          <div className="h-24 bg-surface-2 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div data-settings-panel>
      <h2 data-settings-panel-title>{panel.title}</h2>
      {panel.description && (
        <p className="text-sm text-text-muted mb-4">{panel.description}</p>
      )}

      {/* Username (read-only, outside AutoForm) */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-starlight mb-1">
          Username
        </label>
        <div className="flex items-center gap-2">
          <Input
            value={profile.username}
            disabled
            className="flex-1 opacity-60"
          />
          <Link
            href={`/user/${profile.username}`}
            className="px-3 py-2 text-sm text-nebula hover:underline whitespace-nowrap"
          >
            View
          </Link>
          <Link
            href="/settings/profile"
            className="px-3 py-2 text-sm bg-nebula/20 text-nebula rounded hover:bg-nebula/30 whitespace-nowrap"
          >
            Edit Profile
          </Link>
        </div>
        <p className="text-xs text-starlight/50 mt-1">Username cannot be changed</p>
      </div>

      {/* AutoForm for editable fields */}
      <AutoForm
        schema={ProfileSchema}
        values={formValues}
        onChange={handleChange}
        onSubmit={handleSubmit}
        uiHints={panel.uiHints}
        widgetRegistry={widgetRegistry}
        disabled={saving}
        withSubmit
        submitText={saving ? 'Saving...' : 'Save Profile'}
      >
        {({ fields, submit }) => (
          <div className="space-y-4">
            {fields}

            {/* Character counts */}
            <div className="flex gap-4 text-xs text-starlight/50">
              <span>Bio: {formValues.bio?.length || 0}/500</span>
              <span>CSS: {formValues.profileCss?.length || 0}/10,000</span>
            </div>

            {/* Status message */}
            {message && (
              <div className={`p-3 rounded-lg text-sm ${
                message.type === 'success'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {message.text}
              </div>
            )}

            {/* Dirty state indicator */}
            {isDirty && !message && (
              <p className="text-xs text-solar">You have unsaved changes</p>
            )}

            {/* Submit button */}
            <div className="flex justify-end">
              {submit}
            </div>
          </div>
        )}
      </AutoForm>
    </div>
  );
}
