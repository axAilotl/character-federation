/**
 * Settings Registry
 *
 * Singleton registry for settings panels.
 * Panels are registered here and rendered by the Settings page.
 *
 * To add a new settings panel (e.g., from a module):
 *
 * ```typescript
 * import { settingsRegistry } from '@/lib/settings/registry';
 * import { z } from 'zod';
 *
 * settingsRegistry.registerPanel({
 *   id: 'my-module',
 *   title: 'My Module Settings',
 *   order: 50,
 *   schema: z.object({
 *     apiKey: z.string().describe('API Key'),
 *     enabled: z.boolean().default(true).describe('Enabled'),
 *   }),
 * });
 * ```
 */

import {
  SettingsRegistry,
  WidgetRegistry,
  type SettingsPanel,
  type UIHints,
} from '@character-foundry/character-foundry/app-framework';
import {
  DisplayPreferencesSchema,
  displayPreferencesDefaults,
  ProfileSchema,
  profileDefaults,
  TagPreferencesSchema,
  tagPreferencesDefaults,
} from './schemas';

// Create registry instances for this application
export const settingsRegistry = new SettingsRegistry();
export const widgetRegistry = new WidgetRegistry();

// Register custom styled widgets
import { SwitchWidget } from './widgets/switch';

widgetRegistry.registerComponent('switch', SwitchWidget);
widgetRegistry.registerComponent('checkbox', SwitchWidget); // Also register for checkbox alias

// Re-export types for convenience
export type { SettingsPanel, UIHints };

/**
 * Display Preferences Panel
 * Controls visual appearance and content filtering.
 * Values stored in localStorage.
 */
settingsRegistry.registerPanel({
  id: 'display',
  title: 'Display Preferences',
  description: 'Control how content appears in the app',
  order: 10,
  schema: DisplayPreferencesSchema,
  defaultValues: displayPreferencesDefaults,
  uiHints: {
    blurNsfwContent: {
      widget: 'switch',
      helperText: 'Blur thumbnails and images tagged as NSFW',
    },
    showImagesInGreetings: {
      widget: 'switch',
      helperText: 'Display embedded images in greeting messages',
    },
    cardSize: {
      widget: 'select',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'large', label: 'Large' },
      ],
      helperText: 'Size of character cards in grids',
    },
    sidebarExpanded: {
      widget: 'switch',
      helperText: 'Start with sidebar expanded on page load',
    },
  },
});

/**
 * Profile Panel
 * User profile information.
 * Values stored via API.
 */
settingsRegistry.registerPanel({
  id: 'profile',
  title: 'Profile',
  description: 'Your public profile information',
  order: 20,
  schema: ProfileSchema,
  defaultValues: profileDefaults,
  uiHints: {
    displayName: {
      placeholder: 'Enter a display name',
      helperText: 'Shown instead of your username',
    },
    email: {
      placeholder: 'you@example.com',
      helperText: 'Not displayed publicly',
    },
    bio: {
      widget: 'textarea',
      rows: 4,
      placeholder: 'Tell us about yourself...',
      helperText: 'Max 500 characters',
    },
    profileCss: {
      widget: 'textarea',
      rows: 6,
      placeholder: '/* Custom CSS for your profile page */',
      helperText: 'Advanced: Custom CSS styling for your profile page',
    },
  },
});

/**
 * Tag Preferences Panel
 * Follow/block tags to customize your feed.
 * Note: This panel uses a custom implementation with TagChipSelector
 * rather than AutoForm, so uiHints are not used.
 */
settingsRegistry.registerPanel({
  id: 'tags',
  title: 'Tag Preferences',
  description: 'Customize your feed by following or blocking tags',
  order: 30,
  schema: TagPreferencesSchema,
  defaultValues: tagPreferencesDefaults,
});

/**
 * Get all visible settings panels sorted by order.
 */
export function getSortedPanels() {
  return settingsRegistry.getSortedPanels();
}

/**
 * Get a specific panel by ID.
 */
export function getPanel(id: string) {
  return settingsRegistry.getPanel(id);
}
