import * as cssTree from 'css-tree';
import DOMPurify from 'isomorphic-dompurify';

export interface CssSanitizeOptions {
  /** Scope CSS to a specific selector (e.g., '[data-profile]') */
  scope?: string;
  /** Allow @keyframes animations */
  allowAnimations?: boolean;
  /** Allow @media queries */
  allowMediaQueries?: boolean;
  /** Maximum allowed selectors (DoS protection) */
  maxSelectors?: number;
  /** Maximum nesting depth */
  maxNestingDepth?: number;
}

/** Property whitelist - only these properties are allowed */
const ALLOWED_PROPERTIES = new Set([
  // Layout
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow', 'overflow-x', 'overflow-y', 'overflow-wrap',
  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-content', 'align-self', 'order',
  'grid', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-column', 'grid-row', 'grid-area', 'gap', 'row-gap', 'column-gap',
  'float', 'clear', 'vertical-align',

  // Typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'text-align', 'text-decoration', 'text-decoration-line',
  'text-decoration-color', 'text-decoration-style', 'text-transform',
  'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'word-wrap',
  'color', 'text-shadow', 'text-indent', 'text-overflow',

  // Backgrounds & Borders
  'background', 'background-color', 'background-image', 'background-position',
  'background-size', 'background-repeat', 'background-attachment', 'background-clip',
  'background-origin', 'background-blend-mode',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius',
  'border-bottom-left-radius', 'border-image', 'border-collapse', 'border-spacing',
  'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',

  // Visual Effects
  'opacity', 'visibility', 'box-shadow', 'filter', 'backdrop-filter',
  'transform', 'transform-origin', 'transform-style', 'perspective', 'perspective-origin',
  'transition', 'transition-property', 'transition-duration', 'transition-timing-function',
  'transition-delay',
  'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
  'animation-delay', 'animation-iteration-count', 'animation-direction',
  'animation-fill-mode', 'animation-play-state',

  // Other safe properties
  'cursor', 'pointer-events', 'user-select', 'z-index', 'clip-path', 'list-style',
  'list-style-type', 'list-style-position', 'list-style-image', 'table-layout',
  'caption-side', 'empty-cells', 'resize', 'object-fit', 'object-position',
]);

/** Dangerous properties - NEVER allow these */
const BLOCKED_PROPERTIES = new Set([
  'behavior', '-moz-binding', 'expression', '-ms-filter',
  'binding', 'script', 'javascript', 'vbscript', 'import',
  'content', // Can be used for data exfiltration
]);

/** At-rules whitelist */
const ALLOWED_AT_RULES = new Set(['keyframes', 'media']);

/** Pseudo-classes that can leak info */
const BLOCKED_PSEUDO_CLASSES = new Set([
  'visited', // History sniffing
]);

/**
 * Sanitize CSS string using AST parsing + DOMPurify
 * Returns sanitized CSS or null if invalid
 */
export function sanitizeCss(css: string, options: CssSanitizeOptions = {}): string | null {
  const {
    scope,
    allowAnimations = true,
    allowMediaQueries = true,
    maxSelectors = 500,
    maxNestingDepth = 10,
  } = options;

  // Preserve existing behavior for empty input
  if (css === '') return '';

  // Preserve whitespace-only CSS (treat as valid, but no-op)
  if (css.trim() === '') return css;

  try {
    // Step 0: Cheap nesting-depth check (DoS protection + blocks nested CSS syntax)
    // Depth counts brace nesting outside strings/comments.
    let braceDepth = 0;
    let maxBraceDepth = 0;
    let inString: '"' | "'" | null = null;
    let inComment = false;
    for (let i = 0; i < css.length; i++) {
      const ch = css[i];
      const next = css[i + 1];

      if (inComment) {
        if (ch === '*' && next === '/') {
          inComment = false;
          i++;
        }
        continue;
      }

      if (inString) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }

      if (ch === '/' && next === '*') {
        inComment = true;
        i++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }

      if (ch === '{') {
        braceDepth++;
        if (braceDepth > maxBraceDepth) maxBraceDepth = braceDepth;
        if (maxBraceDepth > maxNestingDepth) {
          throw new Error('Nesting too deep');
        }
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    // Step 1: Parse CSS into AST
    const ast = cssTree.parse(css, {
      parseCustomProperty: true,
      positions: false, // Performance optimization
    });

    let selectorCount = 0;

    // Step 1.5: Reject Raw nodes that appear as *direct* children of blocks.
    // These indicate malformed CSS or nested-rule syntax that css-tree couldn't parse into safe nodes.
    let hasUnsafeRaw = false;
    cssTree.walk(ast, {
      visit: 'Block',
      enter(block) {
        if (!('children' in block) || !block.children) return;
        block.children.forEach((child: any) => {
          if (child?.type === 'Raw') hasUnsafeRaw = true;
        });
      }
    });
    if (hasUnsafeRaw) {
      throw new Error('Invalid CSS');
    }

    // Step 2: Walk AST and remove dangerous nodes
    cssTree.walk(ast, {
      visit: 'Declaration',
      enter(node, item, list) {
        const prop = node.property.toLowerCase();

        // Block dangerous properties
        if (BLOCKED_PROPERTIES.has(prop)) {
          list.remove(item);
          return;
        }

        // Whitelist-only mode: remove non-whitelisted properties
        if (!ALLOWED_PROPERTIES.has(prop) && !prop.startsWith('--')) {
          list.remove(item);
          return;
        }

        // Block dangerous values (e.g., IE expression()) and dangerous URLs inside url()
        let shouldRemoveDeclaration = false;

        // expression() is always unsafe (legacy IE)
        cssTree.walk(node, {
          visit: 'Function',
          enter(fnNode) {
            if (typeof (fnNode as any).name === 'string' && (fnNode as any).name.toLowerCase() === 'expression') {
              shouldRemoveDeclaration = true;
            }
          }
        });

        // Remove declarations with dangerous url() values
        cssTree.walk(node, {
          visit: 'Url',
          enter(urlNode) {
            const rawValue = typeof (urlNode as any).value === 'string'
              ? (urlNode as any).value
              : (urlNode as any).value?.value;

            if (typeof rawValue === 'string' && rawValue.trim() && isDangerousUrl(rawValue)) {
              shouldRemoveDeclaration = true;
            }
          }
        });

        if (shouldRemoveDeclaration) {
          list.remove(item);
          return;
        }
      }
    });

    // Step 3: URL policy helper
    function isDangerousUrl(url: string): boolean {
      const rawValue = url.trim();

      // Block dangerous protocols
      if (/^(javascript|vbscript|file|about):/i.test(rawValue)) {
        return true;
      }

      // Only allow data:image/*, block all other data: URLs
      if (/^data:/i.test(rawValue) && !/^data:image\//i.test(rawValue)) {
        return true;
      }

      // Only allow https:// URLs and data URIs for images
      if (rawValue && !rawValue.startsWith('https://') &&
          !rawValue.startsWith('data:image/') &&
          !rawValue.startsWith('/') && // relative URLs
          !rawValue.startsWith('./') && // relative URLs
          !rawValue.startsWith('../')) { // relative URLs
        // Check if it's just a plain path or has a protocol
        if (rawValue.includes(':')) {
          return true;
        }
      }

      // Block URL encoding tricks
      if (/%[0-9a-f]{2}/i.test(rawValue)) {
        try {
          const decoded = decodeURIComponent(rawValue);
          if (/^(javascript|vbscript|file|about):/i.test(decoded)) {
            return true;
          }
          if (/^data:/i.test(decoded) && !/^data:image\//i.test(decoded)) {
            return true;
          }
        } catch {
          // Invalid encoding
          return true;
        }
      }

      return false;
    }

    // Step 4: Handle @-rules
    cssTree.walk(ast, {
      visit: 'Atrule',
      enter(node, item, list) {
        const ruleName = node.name.toLowerCase();

        // Always block @import (can load external resources)
        if (ruleName === 'import') {
          list.remove(item);
          return;
        }

        // Block @font-face (can load external fonts with tracking)
        if (ruleName === 'font-face') {
          list.remove(item);
          return;
        }

        // Conditionally allow animations and media queries
        if (ruleName === 'keyframes' && !allowAnimations) {
          list.remove(item);
          return;
        }

        if (ruleName === 'media' && !allowMediaQueries) {
          list.remove(item);
          return;
        }

        // Block all other at-rules
        if (!ALLOWED_AT_RULES.has(ruleName)) {
          list.remove(item);
        }
      }
    });

    // Step 5: Block dangerous pseudo-classes
    cssTree.walk(ast, {
      visit: 'PseudoClassSelector',
      enter(node, item, list) {
        const pseudoClass = node.name.toLowerCase();
        if (BLOCKED_PSEUDO_CLASSES.has(pseudoClass)) {
          list.remove(item);
        }
      }
    });

    // Step 6: Count selectors for DoS protection
    cssTree.walk(ast, {
      visit: 'Selector',
      enter() {
        selectorCount++;
        if (selectorCount > maxSelectors) {
          throw new Error('Too many selectors');
        }
      }
    });

    // Step 8: Generate sanitized CSS
    let sanitized = cssTree.generate(ast);

    // Step 9: Apply scoping if requested
    if (scope) {
      sanitized = scopeCss(sanitized, scope);
    }

    // Step 10: Second pass with DOMPurify for defense-in-depth
    // DOMPurify.sanitize() can handle CSS in newer versions
    if (typeof (DOMPurify as any).sanitizeCSS === 'function') {
      sanitized = (DOMPurify as any).sanitizeCSS(sanitized);
    }

    // Keep a truthy string for "valid but fully stripped" CSS so callers can
    // distinguish between "invalid" (null) and "sanitized to nothing" (string).
    if (sanitized === '' && css.trim() !== '') {
      return ' ';
    }

    return sanitized;
  } catch (error) {
    // Invalid CSS or security violation
    console.error('CSS sanitization failed:', error);
    return null;
  }
}

/**
 * Scope CSS by prepending a selector to all rules
 */
function scopeCss(css: string, scope: string): string {
  try {
    const ast = cssTree.parse(css);

    cssTree.walk(ast, {
      visit: 'Rule',
      enter(node) {
        // Prepend scope to each selector
        if (node.prelude && node.prelude.type === 'SelectorList') {
          const selectorList = node.prelude;
          const newSelectors: cssTree.CssNode[] = [];

          // Iterate through each selector in the list
          selectorList.children.forEach((selector) => {
            if (selector.type === 'Selector') {
              // Parse the scope selector
              const scopeAst = cssTree.parse(scope, { context: 'selector' }) as cssTree.Selector;

              // Create a new selector: scope + descendant combinator + original selector
              const newSelector: cssTree.Selector = {
                type: 'Selector',
                children: new cssTree.List<cssTree.CssNode>(),
              };

              // Add scope selector nodes
              scopeAst.children.forEach((child) => {
                newSelector.children.appendData(child);
              });

              // Add descendant combinator (space)
              newSelector.children.appendData({
                type: 'WhiteSpace',
                value: ' ',
              } as cssTree.WhiteSpace);

              // Add original selector nodes
              selector.children.forEach((child) => {
                newSelector.children.appendData(child);
              });

              newSelectors.push(newSelector);
            }
          });

          // Replace selector list with scoped selectors
          selectorList.children = new cssTree.List<cssTree.CssNode>();
          newSelectors.forEach((sel) => selectorList.children.appendData(sel));
        }
      }
    });

    return cssTree.generate(ast);
  } catch {
    return css; // Fallback: return original if scoping fails
  }
}

/**
 * Validate that CSS doesn't try to hide/break critical UI elements
 */
export function validateNoUiBreaking(css: string): { valid: boolean; reason?: string } {
  // Check for attempts to hide navigation, buttons, etc.
  const dangerousPatterns = [
    /display:\s*none\s*!important/i,
    /visibility:\s*hidden\s*!important/i,
    /opacity:\s*0\s*!important/i,
    /position:\s*fixed[\s\S]*z-index:\s*9999/i, // Overlay attacks
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(css)) {
      return { valid: false, reason: 'CSS attempts to hide or overlay UI elements' };
    }
  }

  return { valid: true };
}
