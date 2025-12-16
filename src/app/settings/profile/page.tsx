'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { AppShell } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileCss: string | null;
}

type EditorMode = 'normal' | 'pro';

export default function EditProfilePage() {
  const router = useRouter();
  const { user, refresh } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [profileCss, setProfileCss] = useState('');
  const [bioHtml, setBioHtml] = useState(''); // HTML bio for pro mode
  const [editorMode, setEditorMode] = useState<EditorMode>('normal');
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [user, router]);

  // Fetch profile
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
        setBioHtml(data.bio || ''); // Pro mode uses same bio field
        setProfileCss(data.profileCss || '');
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // Derive the effective bio based on mode
  const effectiveBio = editorMode === 'pro' ? bioHtml : bio;

  // Live preview component
  const PreviewProfile = useMemo(() => {
    if (!profile) return null;

    return (
      <div className="profile-preview">
        {/* Inject preview CSS */}
        {profileCss && (
          <style dangerouslySetInnerHTML={{ __html: profileCss }} />
        )}

        <div className="profile-container">
          {/* Avatar and name */}
          <div className="flex items-start gap-4 mb-4">
            <div className="w-20 h-20 rounded-full bg-nebula/30 flex items-center justify-center text-3xl text-starlight flex-shrink-0">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                profile.username[0].toUpperCase()
              )}
            </div>

            <div>
              <h2 className="text-xl font-bold text-starlight">
                {displayName || profile.username}
              </h2>
              {displayName && (
                <p className="text-starlight/60">@{profile.username}</p>
              )}
            </div>
          </div>

          {/* Bio */}
          {effectiveBio && (
            <div className="profile-bio mb-4">
              {editorMode === 'pro' ? (
                <div
                  className="text-starlight/80 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(effectiveBio, {
                      ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'span', 'div'],
                      ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
                      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
                    })
                  }}
                />
              ) : (
                <p className="text-starlight/80 whitespace-pre-wrap">
                  {effectiveBio}
                </p>
              )}
            </div>
          )}

          {/* Sample stats */}
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <div className="font-bold text-starlight">0</div>
              <div className="text-starlight/50 text-xs">Followers</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-starlight">0</div>
              <div className="text-starlight/50 text-xs">Following</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-starlight">0</div>
              <div className="text-starlight/50 text-xs">Cards</div>
            </div>
          </div>
        </div>
      </div>
    );
  }, [profile, displayName, effectiveBio, profileCss, editorMode]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          email: email.trim() || null,
          bio: effectiveBio.trim() || null,
          profileCss: profileCss.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      const data = await res.json();
      setProfile(data);
      setMessage({ type: 'success', text: 'Profile saved successfully!' });
      refresh(); // Refresh auth context
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  if (!user || isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-nebula" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">Edit Profile</h1>
            <p className="text-starlight/60">
              Customize your public profile appearance
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/user/${profile?.username}`}>
              <Button variant="ghost">View Profile</Button>
            </Link>
            <Link href="/settings">
              <Button variant="secondary">Settings</Button>
            </Link>
          </div>
        </div>

        {/* Two column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column - Editor */}
          <div className="glass rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-starlight">Edit</h2>

              {/* Mode toggle */}
              <div className="flex rounded-lg bg-deep-space p-1">
                <button
                  onClick={() => setEditorMode('normal')}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-md transition-colors',
                    editorMode === 'normal'
                      ? 'bg-nebula text-white'
                      : 'text-starlight/60 hover:text-starlight'
                  )}
                >
                  Normal
                </button>
                <button
                  onClick={() => setEditorMode('pro')}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-md transition-colors',
                    editorMode === 'pro'
                      ? 'bg-nebula text-white'
                      : 'text-starlight/60 hover:text-starlight'
                  )}
                >
                  Pro (HTML)
                </button>
              </div>
            </div>

            <div className="space-y-5">
              {/* Display name */}
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
              </div>

              {/* Email */}
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
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm font-medium text-starlight mb-1">
                  Bio {editorMode === 'pro' && <span className="text-nebula">(HTML enabled)</span>}
                </label>
                <textarea
                  value={editorMode === 'pro' ? bioHtml : bio}
                  onChange={(e) => {
                    if (editorMode === 'pro') {
                      setBioHtml(e.target.value);
                    } else {
                      setBio(e.target.value);
                    }
                  }}
                  placeholder={editorMode === 'pro'
                    ? '<p>Your bio with <strong>HTML</strong> formatting...</p>'
                    : 'Tell others about yourself...'
                  }
                  maxLength={2000}
                  rows={editorMode === 'pro' ? 8 : 4}
                  className={cn(
                    'w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/40 focus:outline-none focus:border-nebula resize-y',
                    editorMode === 'pro' && 'font-mono text-sm'
                  )}
                />
                <p className="text-xs text-starlight/50 mt-1">
                  {(editorMode === 'pro' ? bioHtml : bio).length}/2000 characters
                </p>
              </div>

              {/* Profile CSS */}
              <div>
                <label className="block text-sm font-medium text-starlight mb-1">
                  Profile CSS <span className="text-nebula">(MySpace style!)</span>
                </label>
                <textarea
                  value={profileCss}
                  onChange={(e) => setProfileCss(e.target.value)}
                  placeholder={`.profile-container {\n  background: linear-gradient(...);\n}\n.profile-bio {\n  color: #fff;\n}`}
                  maxLength={10000}
                  rows={8}
                  className="w-full px-3 py-2 bg-deep-space border border-nebula/30 rounded-lg text-starlight placeholder:text-starlight/40 focus:outline-none focus:border-nebula resize-y font-mono text-sm"
                />
                <p className="text-xs text-starlight/50 mt-1">
                  {profileCss.length}/10000 characters - Custom CSS applied to your profile
                </p>
              </div>

              {/* Message */}
              {message && (
                <div className={cn(
                  'p-3 rounded-lg text-sm',
                  message.type === 'success'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                )}>
                  {message.text}
                </div>
              )}

              {/* Save button */}
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </div>

          {/* Right column - Preview */}
          <div className="glass rounded-xl p-6">
            <h2 className="text-lg font-semibold text-starlight mb-6">Preview</h2>

            <div className="bg-cosmic-teal/30 rounded-lg p-4 min-h-[300px]">
              {PreviewProfile}
            </div>

            <p className="text-xs text-starlight/50 mt-4">
              This is a preview of how your profile will appear to others.
              Custom CSS is applied in real-time.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
