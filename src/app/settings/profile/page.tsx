'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth/context';

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  bio: string | null;
}

export default function EditProfilePage() {
  const router = useRouter();
  const { user, refresh } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
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
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    } finally {
      setIsLoading(false);
    }
  }

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
          bio: bio.trim() || null,
        }),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Profile updated successfully!' });
        await refresh();
      } else {
        const error = await res.json();
        setMessage({ type: 'error', text: error.error || 'Failed to update profile' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;

  if (isLoading) {
    return (
      <AppShell>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-nebula"></div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="min-h-screen py-8">
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="text-3xl font-bold text-starlight mb-8">Edit Profile</h1>

          <div className="glass rounded-xl p-6 space-y-6">
            {/* Display Name */}
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-starlight mb-2">
                Display Name
              </label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={profile?.username}
                maxLength={50}
              />
              <p className="text-xs text-starlight/50 mt-1">
                Leave empty to use your username (@{profile?.username})
              </p>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-starlight mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                maxLength={100}
              />
              <p className="text-xs text-starlight/50 mt-1">
                Optional. Not displayed publicly.
              </p>
            </div>

            {/* Bio */}
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-starlight mb-2">
                Bio
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
                maxLength={500}
                rows={4}
                className="w-full px-4 py-3 bg-cosmic-teal/50 border border-nebula/20 rounded-lg text-starlight placeholder-starlight/40 focus:outline-none focus:ring-2 focus:ring-nebula/50 resize-none"
              />
              <p className="text-xs text-starlight/50 mt-1">
                {bio.length}/500 characters
              </p>
            </div>

            {/* Message */}
            {message && (
              <div
                className={`p-4 rounded-lg ${
                  message.type === 'success'
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}
              >
                {message.text}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button variant="secondary" onClick={() => router.push(`/user/${profile?.username}`)}>
                View Profile
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
