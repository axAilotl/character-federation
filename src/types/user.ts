// User types

export interface User {
  id: string;
  email: string | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null; // v1.1: User bio/about section
  profileCss: string | null; // v1.1: Custom CSS for profile page
  provider: 'email' | 'google' | 'discord' | 'github' | null;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Auth request/response types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface AuthResponse {
  user: User;
  session: Session;
}

export interface OAuthCallbackData {
  provider: 'google' | 'discord' | 'github';
  code: string;
  state?: string;
}

// v1.1: Tag Preferences
export type TagPreferenceType = 'follow' | 'block';

export interface TagPreference {
  userId: string;
  tagId: number;
  preference: TagPreferenceType;
  createdAt: number;
}

export interface TagWithPreference {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  preference: TagPreferenceType;
}

// v1.1: User Follows
export interface UserFollow {
  followerId: string;
  followingId: string;
  createdAt: number;
}

export interface UserWithFollowStatus {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isFollowing: boolean;
  followersCount: number;
  followingCount: number;
}

// v1.1: Social Feed
export interface FeedItem {
  type: 'card';
  card: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    creator: string | null;
    thumbnailPath: string | null;
    upvotes: number;
    downloadsCount: number;
  };
  reason: 'followed_user' | 'followed_tag' | 'trending';
  uploader: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  createdAt: number;
}
