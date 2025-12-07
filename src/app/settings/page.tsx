'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout';
import { useSettings } from '@/lib/settings';
import { useAuth } from '@/lib/auth/context';
import { Button, Input, TagChipSelector, type TagInfo } from '@/components/ui';

interface TagInfoWithCount extends TagInfo {
  usage_count: number;
}

// NOTE: Tag blocking is handled ONLY by TagPreferencesManager (database-backed)
// The old BannedTagsManager (localStorage) has been removed to avoid duplication

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-4 cursor-pointer group">
      <div className="relative flex-shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-cosmic-teal/50 rounded-full peer peer-checked:bg-nebula transition-colors" />
        <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-starlight rounded-full shadow transform peer-checked:translate-x-5 transition-transform" />
      </div>
      <div className="flex-1">
        <div className="font-medium text-starlight group-hover:text-nebula transition-colors">
          {label}
        </div>
        {description && (
          <div className="text-sm text-starlight/60 mt-0.5">{description}</div>
        )}
      </div>
    </label>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl p-6 mb-6">
      <h2 className="text-lg font-semibold gradient-text mb-6">{title}</h2>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

interface TagPreference {
  tagId: number;
  tagName: string;
  tagSlug: string;
  preference: 'follow' | 'block';
}

function TagPreferencesManager() {
  const [allTags, setAllTags] = useState<TagInfoWithCount[]>([]);
  const [preferences, setPreferences] = useState<TagPreference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [tagsRes, prefsRes] = await Promise.all([
          fetch('/api/tags'),
          fetch('/api/users/me/tags'),
        ]);

        if (tagsRes.ok) {
          const data = await tagsRes.json();
          const tags: TagInfoWithCount[] = [];
          for (const group of data) {
            tags.push(...group.tags);
          }
          setAllTags(tags);
        }

        if (prefsRes.ok) {
          const data = await prefsRes.json();
          // API returns { followed, blocked } arrays - convert to preferences format
          const prefs: TagPreference[] = [];
          for (const tag of data.followed || []) {
            prefs.push({ tagId: tag.id, tagName: tag.name, tagSlug: tag.slug, preference: 'follow' });
          }
          for (const tag of data.blocked || []) {
            prefs.push({ tagId: tag.id, tagName: tag.name, tagSlug: tag.slug, preference: 'block' });
          }
          setPreferences(prefs);
        }
      } catch (err) {
        console.error('Error fetching tag data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  // Convert preferences to TagInfo arrays for the selectors
  const followedTags = useMemo(() =>
    preferences
      .filter(p => p.preference === 'follow')
      .map(p => ({ id: p.tagId, name: p.tagName, slug: p.tagSlug, category: null })),
    [preferences]
  );

  const blockedTags = useMemo(() =>
    preferences
      .filter(p => p.preference === 'block')
      .map(p => ({ id: p.tagId, name: p.tagName, slug: p.tagSlug, category: null })),
    [preferences]
  );

  // Available tags excluding already preferenced ones
  const availableForFollow = useMemo(() => {
    const blockedIds = new Set(blockedTags.map(t => t.id));
    const followedIds = new Set(followedTags.map(t => t.id));
    return allTags.filter(t => !blockedIds.has(t.id) && !followedIds.has(t.id));
  }, [allTags, blockedTags, followedTags]);

  const availableForBlock = useMemo(() => {
    const blockedIds = new Set(blockedTags.map(t => t.id));
    const followedIds = new Set(followedTags.map(t => t.id));
    return allTags.filter(t => !blockedIds.has(t.id) && !followedIds.has(t.id));
  }, [allTags, blockedTags, followedTags]);

  const updatePreference = useCallback(async (tagId: number, tagName: string, tagSlug: string, preference: 'follow' | 'block' | null) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/users/me/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId, preference }),
      });

      if (res.ok) {
        if (preference === null) {
          setPreferences(prev => prev.filter(p => p.tagId !== tagId));
        } else {
          const existing = preferences.find(p => p.tagId === tagId);
          if (existing) {
            setPreferences(prev => prev.map(p =>
              p.tagId === tagId ? { ...p, preference } : p
            ));
          } else {
            setPreferences(prev => [...prev, { tagId, tagName, tagSlug, preference }]);
          }
        }
      }
    } catch (err) {
      console.error('Error updating preference:', err);
    } finally {
      setIsSaving(false);
    }
  }, [preferences]);

  const handleFollowAdd = useCallback((tag: TagInfo) => {
    updatePreference(tag.id, tag.name, tag.slug, 'follow');
  }, [updatePreference]);

  const handleFollowRemove = useCallback((tagId: number) => {
    const pref = preferences.find(p => p.tagId === tagId);
    if (pref) {
      updatePreference(tagId, pref.tagName, pref.tagSlug, null);
    }
  }, [preferences, updatePreference]);

  const handleBlockAdd = useCallback((tag: TagInfo) => {
    updatePreference(tag.id, tag.name, tag.slug, 'block');
  }, [updatePreference]);

  const handleBlockRemove = useCallback((tagId: number) => {
    const pref = preferences.find(p => p.tagId === tagId);
    if (pref) {
      updatePreference(tagId, pref.tagName, pref.tagSlug, null);
    }
  }, [preferences, updatePreference]);

  return (
    <div className="space-y-8">
      <TagChipSelector
        label="Followed Tags"
        description="Cards with these tags will appear in your personalized feed"
        selectedTags={followedTags}
        availableTags={availableForFollow}
        onAdd={handleFollowAdd}
        onRemove={handleFollowRemove}
        variant="green"
        placeholder="Search tags to follow..."
        disabled={isSaving}
        isLoading={isLoading}
      />

      <TagChipSelector
        label="Blocked Tags"
        description="Cards with these tags will be hidden from your feed"
        selectedTags={blockedTags}
        availableTags={availableForBlock}
        onAdd={handleBlockAdd}
        onRemove={handleBlockRemove}
        variant="red"
        placeholder="Search tags to block..."
        disabled={isSaving}
        isLoading={isLoading}
      />
    </div>
  );
}

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileCss: string | null;
}

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const { user, refresh } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [profileCss, setProfileCss] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
        setDisplayName(data.displayName || '');
        setEmail(data.email || '');
        setBio(data.bio || '');
        setProfileCss(data.profileCss || '');
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          email: email.trim() || null,
          bio: bio.trim() || null,
          profileCss: profileCss.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      const data = await res.json();
      setProfile(data);
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      refresh(); // Refresh auth context
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Settings</h1>
          <p className="text-starlight/60">
            Customize your CardsHub experience
          </p>
        </div>

        {/* Profile Section - only show if logged in */}
        {user && profile && (
          <SettingsSection title="Profile">
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
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
                    className="px-3 py-2 text-sm text-nebula hover:underline"
                  >
                    View
                  </Link>
                  <Link
                    href="/settings/profile"
                    className="px-3 py-2 text-sm bg-nebula/20 text-nebula rounded hover:bg-nebula/30"
                  >
                    Edit Profile
                  </Link>
                </div>
                <p className="text-xs text-starlight/50 mt-1">Username cannot be changed</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-starlight mb-1">
                  Display Name
                </label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your display name"
                  maxLength={50}
                />
                <p className="text-xs text-starlight/50 mt-1">
                  Shown instead of username on your profile
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-starlight mb-1">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                />
                <p className="text-xs text-starlight/50 mt-1">
                  Used for notifications and account recovery
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-starlight mb-1">
                  Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell others about yourself..."
                  maxLength={2000}
                  rows={4}
                  className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/40 focus:outline-none focus:border-nebula resize-y"
                />
                <p className="text-xs text-starlight/50 mt-1">
                  {bio.length}/2000 characters - Displayed on your public profile
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-starlight mb-1">
                  Profile CSS
                </label>
                <textarea
                  value={profileCss}
                  onChange={(e) => setProfileCss(e.target.value)}
                  placeholder={`.profile-container {\n  /* Your custom styles */\n}`}
                  maxLength={10000}
                  rows={6}
                  className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/40 focus:outline-none focus:border-nebula resize-y font-mono text-sm"
                />
                <p className="text-xs text-starlight/50 mt-1">
                  {profileCss.length}/10000 characters - Custom CSS applied to your profile page (MySpace style!)
                </p>
              </div>

              {message && (
                <div className={`p-3 rounded-lg text-sm ${
                  message.type === 'success'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Profile'}
                </Button>
              </div>
            </form>
          </SettingsSection>
        )}

        {!user && (
          <SettingsSection title="Profile">
            <div className="text-center py-4">
              <p className="text-starlight/70 mb-3">Log in to manage your profile</p>
              <Link
                href="/login"
                className="inline-block px-4 py-2 bg-nebula hover:bg-nebula/80 text-white rounded-lg transition-colors"
              >
                Log In
              </Link>
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="Content Display">
          <Toggle
            checked={settings.showImagesInGreetings}
            onChange={(checked) => updateSettings({ showImagesInGreetings: checked })}
            label="Show images in greetings"
            description="Display embedded images in first messages and alternate greetings"
          />

          <Toggle
            checked={settings.blurNsfwContent}
            onChange={(checked) => updateSettings({ blurNsfwContent: checked })}
            label="Blur NSFW content"
            description="Blur card images tagged as NSFW until hovered"
          />
        </SettingsSection>

        {/* Tag Preferences - only show if logged in */}
        {user && (
          <SettingsSection title="Tag Preferences">
            <p className="text-sm text-starlight/60 -mt-4 mb-4">
              Follow tags to see them in your feed, block tags to hide cards from everywhere.
            </p>
            <TagPreferencesManager />
          </SettingsSection>
        )}

        <SettingsSection title="Interface">
          <Toggle
            checked={settings.sidebarExpanded}
            onChange={(checked) => updateSettings({ sidebarExpanded: checked })}
            label="Expanded sidebar"
            description="Keep the sidebar expanded by default"
          />

          <div className="space-y-2">
            <div className="font-medium text-starlight">Card size</div>
            <div className="text-sm text-starlight/60 mb-3">
              Adjust the size of cards in the grid view
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => updateSettings({ cardSize: 'normal' })}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  settings.cardSize === 'normal'
                    ? 'border-nebula bg-nebula/20 text-nebula'
                    : 'border-nebula/30 text-starlight/60 hover:border-nebula/50'
                }`}
              >
                Normal
              </button>
              <button
                onClick={() => updateSettings({ cardSize: 'large' })}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  settings.cardSize === 'large'
                    ? 'border-nebula bg-nebula/20 text-nebula'
                    : 'border-nebula/30 text-starlight/60 hover:border-nebula/50'
                }`}
              >
                Large (+25%)
              </button>
            </div>
          </div>
        </SettingsSection>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={resetSettings}>
            Reset to Defaults
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
