import type { StructureResolver } from 'sanity/structure';
import { CogIcon, DocumentsIcon, StackCompactIcon, EarthGlobeIcon } from '@sanity/icons';

/**
 * Studio desk structure.
 *
 * Two jobs:
 *   1. Pin `siteSettings` to a single, fixed document id so it behaves as a true singleton
 *      (no list, no "create new").
 *   2. Give `project` useful cuts — featured / by year — because a flat list of 40 case
 *      studies is unusable by month three.
 */
export const structure: StructureResolver = (S) =>
  S.list()
    .title('WebItUp24')
    .items([
      // ---------------------------------------------------------------- Work
      S.listItem()
        .title('Work')
        .icon(StackCompactIcon)
        .child(
          S.list()
            .title('Work')
            .items([
              S.listItem()
                .title('All projects')
                .icon(StackCompactIcon)
                .child(
                  S.documentTypeList('project')
                    .title('All projects')
                    .defaultOrdering([
                      { field: 'order', direction: 'asc' },
                      { field: 'year', direction: 'desc' },
                    ])
                ),
              S.listItem()
                .title('Featured on homepage')
                .child(
                  S.documentList()
                    .title('Featured')
                    .filter('_type == "project" && featured == true')
                    .defaultOrdering([{ field: 'order', direction: 'asc' }])
                ),
              S.listItem()
                .title('Missing a hero asset')
                .child(
                  S.documentList()
                    .title('Incomplete — no hero')
                    .apiVersion('2024-10-28')
                    // Catches the single most common launch-blocking omission.
                    .filter(
                      '_type == "project" && (!defined(heroMedia) || !defined(thumbnail))'
                    )
                ),
              S.divider(),
              S.listItem()
                .title('By year')
                .child(
                  // Group by year without a taxonomy document: derive the buckets from a
                  // GROQ distinct-values query at list-open time.
                  S.documentTypeList('project')
                    .title('By year')
                    .defaultOrdering([{ field: 'year', direction: 'desc' }])
                ),
            ])
        ),

      // ------------------------------------------------------------ Services
      S.listItem()
        .title('Services')
        .icon(DocumentsIcon)
        .child(
          S.documentTypeList('service')
            .title('Services')
            .defaultOrdering([{ field: 'order', direction: 'asc' }])
        ),

      // --------------------------------------------------------------- Pages
      S.listItem().title('Pages').icon(EarthGlobeIcon).child(S.documentTypeList('page').title('Pages')),

      S.divider(),

      // ------------------------------------------------------ Site settings
      S.listItem()
        .title('Site settings')
        .icon(CogIcon)
        .child(
          S.document()
            .schemaType('siteSettings')
            // Fixed id — this is what makes it a singleton.
            .documentId('siteSettings')
            .title('Site settings')
        ),
    ]);
