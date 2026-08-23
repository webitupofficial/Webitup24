import type { SchemaTypeDefinition } from 'sanity';

import { caseStudyModules, heroMedia, richText } from './objects/caseStudyModules';
import { colorPalette, colorToken } from './objects/colorPalette';
import { link, socialLink } from './objects/link';
import { model3d } from './objects/model3d';
import { seo } from './objects/seo';
import { page } from './documents/page';
import { project } from './documents/project';
import { service } from './documents/service';
import { siteSettings } from './documents/siteSettings';

/**
 * The schema registry consumed by sanity.config.ts.
 *
 * Order matters only for the Studio's "create new document" menu; objects are resolved by
 * name regardless. Documents first so the menu leads with the things editors actually create.
 */
export const schemaTypes: SchemaTypeDefinition[] = [
  // Documents
  project,
  service,
  page,
  siteSettings,

  // Objects — shared building blocks
  seo,
  link,
  socialLink,
  colorToken,
  colorPalette,
  model3d,
  heroMedia,
  richText,

  // Objects — case-study modules
  ...caseStudyModules,
];
