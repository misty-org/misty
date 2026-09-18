#!/usr/bin/env node

/**
 * Anti-Pattern Detector for Impeccable
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public API facade. Runtime engines live under cli/engine/engines/.
 */

import { detectCli } from './cli/main.ts';

export { ANTIPATTERNS, RULE_ENGINE_SUPPORT, getAntipattern, getRulesForCategory, getRuleEngineSupport } from './registry/antipatterns.ts';
export { SAFE_TAGS, BORDER_SAFE_TAGS, OVERUSED_FONTS, GENERIC_FONTS, KNOWN_SERIF_FONTS } from './shared/constants.ts';
export { isNeutralColor, parseRgb, relativeLuminance, contrastRatio, parseGradientColors, hasChroma, getHue, colorToHex } from './shared/color.ts';
export { isFullPage } from './shared/page.ts';
export {
  checkElementBorders,
  checkElementMotion,
  checkElementGlow,
  checkPageTypography,
  checkPageLayout,
  checkHtmlPatterns,
} from './rules/checks.ts';
export { createDetectorProfile, summarizeDetectorProfile } from './profile/profiler.ts';
export {
  parseFrontmatter as parseDesignFrontmatter,
  normalizeDesignSystem,
  loadDesignSystemForCwd,
  checkSourceDesignSystem,
  collectStaticDesignSystemFindings,
} from './design-system.ts';
export { detectHtml } from './engines/static-html/detect-html.ts';
export { detectUrl, createBrowserDetector } from './engines/browser/detect-url.ts';
export { detectText, extractStyleBlocks, extractCSSinJS } from './engines/regex/detect-text.ts';
export {
  walkDir,
  hasScannableExtension,
  SCANNABLE_EXTENSIONS,
  SKIP_DIRS,
  buildImportGraph,
  resolveImport,
  detectFrameworkConfig,
  isPortListening,
  FRAMEWORK_CONFIGS,
} from './node/file-system.ts';
export { formatFindings, detectCli } from './cli/main.ts';

const isMainModule = process.argv[1]?.endsWith('detect-antipatterns.ts') ||
  process.argv[1]?.endsWith('detect-antipatterns.ts/');
if (isMainModule) detectCli();
