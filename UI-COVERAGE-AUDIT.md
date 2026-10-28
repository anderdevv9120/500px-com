# 500px UI coverage audit

Checked October 28, 2026 against the running clone at `http://localhost:5000`.

### Item 3 follow-up, October 28, 2026

Blog listing and article layouts are now implemented from a working original rendering. The public [500px Blog](https://iso.500px.com/) and [Into the Mist article](https://iso.500px.com/into-the-mist-creating-atmosphere-with-fog-photography/) were inspected in Chrome at 1440 × 900 and 390 × 900 using an isolated browser with a request-only public-DNS override. Reference captures are in `.reference/blog-{listing,article}-{desktop,mobile}.png`. Initial verification used the project's external Playwright/Chrome workflow because the Chrome DevTools MCP profile was occupied. A later DevTools retry connected successfully and independently checked the local listing and Fog article at both sizes, including mobile touch, article navigation, sharing, the mobile menu/Escape, images, overflow, console messages, and network failures. No issues were found in these checks. DevTools screenshot-file writes were blocked by its workspace configuration; its inline screenshots were inspected.

The local `/blog` now has the reference's light theme, Open Sans typography, category navigation, full-width photographic feature, five Top Posts rows, eleven Latest Posts cards, and pale footer. All 16 visible stories open local `/blog/:slug` pages with a hero/title/byline, reading column, images, sharing, previous/next links, and return navigation. The main Fog article retains all five reference body photographs and the heading hierarchy. Categories use the captured finite story set, with explicit empty and missing-page states. Shared logo, login, sharing dialog, escaping, and static routing are reused. Capture/preparation tools preserve the finished Blog.

This closes the layout gap, with limits: excerpts and article text are condensed/representative; the other fifteen stories reuse the inspected article template with their own title and photography. Category result layouts are representative, rather than separately captured references. The original mobile navigation overflow is corrected locally. Ads, live social widgets, full archives, search behavior, and backend integration are not implemented. Source photography is saved locally and oversized files are resized for the reading column. These differences mean this is not a pixel-for-pixel copy of every article or live state.

Verification: `tools/blog-check.mjs` passes 42 route/viewport checks at desktop 1440 × 900 and mobile/touch 390 × 900, with additional listing/article checks at 320 and 768 pixels. It covers all 16 story routes, card navigation, trailing-slash/query reloads, previous/next links, sharing, keyboard categories, filtered categories, mobile menu/Escape, missing routes, and the reused signup dialog. No broken images, horizontal overflow, failed local responses, or uncaught JavaScript errors were found. Evidence: `screenshots/blog-results.json` and `screenshots/blog-{listing,article,category}-{desktop,mobile}.png`. `npm run lint` also passes. Prior gallery and Licensing Quest checks were rerun separately; their results retain their original scope.

Manager/account screens, Membership, search behavior, and backend integration remain excluded. No Manager findings were implemented.

### Item 2 follow-up, October 28, 2026

All 20 captured Licensing Quest routes now use `pages/quest-licensing.html` instead of the mountain Battle template. They retain their captured title, hero image, submission dates and ended state. The shared Licensing variant includes the Juried/Licensing label, organizer, Introduction/All Entries tabs, sharing, Licensing brief sections, submission/announcement schedule, cash awards, and model/property release rules with local guide links. Battle credits, voting schedules, prize-pool tiers and mountain-specific copy are absent from this variant.

The original rendering still refuses browser connections. Indexed official [After Hours](https://500px.com/quest/1000005269-after-hours) and [On the Clock](https://500px.com/quest/1000005271-on-the-clock) references establish the content structure and sample award/count details. The implementation reuses the captured Juried shell; full visual fidelity is unverified. Briefs are condensed/paraphrased, other contest brief/award text is representative, and All Entries uses seeded photos.

Verification: 40 route/viewport checks at 1440 × 900 and mobile/touch 390 × 900, plus card navigation, trailing-slash/query reloads, keyboard tabs, sharing, ended state, hero/title matching, and existing Battle/Juried template checks. No broken images, horizontal overflow, failed local responses or uncaught JavaScript errors were found. Repeat with `tools/quest-licensing-check.mjs`; evidence is in `screenshots/quest-licensing-results.json` and `screenshots/quest-licensing-{desktop,mobile}.png`. Chrome DevTools additionally checked desktop and mobile/touch geometry.

At completion of Item 2, Blog was next and still required an accessible original rendering. This dependency is resolved by Item 3 above. Manager/account screens, Membership, search behavior, and backend integration remain excluded.

### Item 1 follow-up, October 28, 2026

Standalone gallery pages are now implemented at `/galleries/:id` and `/gallery/:id`. Profile cards retain their curator context; all five Grant collection links stay local. The shared page includes gallery title, owner information, photo count, credited photos, sharing, slideshow, and return navigation. The original gallery rendering remains inaccessible, so this closes the local page/navigation gap without claiming visual parity. Profile collections use representative captured photos; Grant collections use their captured previews.

Desktop (1440 × 900) and mobile (390 × 900) browser checks cover the profile galleries and all five Grants, navigation/reload, sharing, slideshow, photo credits, return links, and missing-gallery handling. Evidence: `screenshots/gallery-results.json` and `screenshots/gallery-{profile,grant}-{desktop,mobile}.png`; repeat with `tools/gallery-check.mjs`. Chrome DevTools also checked desktop rendering and mobile touch emulation.

The findings below record the pre-implementation audit. Manager/account screens, Membership, search behavior, and backend integration are excluded from this continuation. Licensing Quest details are covered by Item 2; Blog layouts and their remaining fidelity limits are covered by Item 3 above.

Scope: page layouts, visible components, and page variants. Search behavior, backend integration, live data, and demo-state correctness are excluded, as requested. Reusing a layout with hard-coded content is acceptable.

The main public sections are present. The strongest remaining UI gaps are gallery detail pages and the Licensing Quest detail variant. Manager screens are also absent if the clone is intended to cover the signed-in experience. Blog fidelity remains unverified.

## Confirmed gaps

| Priority | Page/component | What is present now | Remaining UI work |
| --- | --- | --- | --- |
| High | Standalone gallery detail | Profile gallery cards open a small generic photo-grid dialog. `/galleries/0` returns 404 when opened directly. The five full Grant collections open the original site. | Add a reusable gallery detail screen and local route. Capture its reference layout before implementing the gallery header, owner information, actions, and photo grid. |
| High | Licensing Quest detail variant | `/quest/1000005269-after-hours` renders the mountain Photo Battle layout. Its runtime title becomes “After Hours,” but the hero, “Photo Battles” label, credits CTA, introduction, schedule, and prize-pool sections remain from the mountain contest. | Capture and implement the Licensing Quest page variant. The 20 Licensing cards currently lead into the Battle template. Juried and Battle detail samples already exist. |
| Medium, signed-in scope | Photo Manager and Licensing Manager | `/manager/works`, `/manager/licensing`, and `/upload` all open the same basic file/title/category upload dialog over the feed. | Add the manager screen layouts if signed-in pages are included. A reusable manager shell with hard-coded entries is enough for this scope. |
| Unverified | Blog listing and article layouts | `renderBlog()` builds a custom six-article listing and custom article view. README explicitly identifies these as illustrative because the original Blog capture was empty. | Obtain a working reference and check the listing, article header/body, navigation, and footer. The current implementation cannot be counted as verified 1:1 UI. |

Relevant implementation locations:

- Gallery cards and dialog: `app.js:371` and `app.js:476`; route handling: `server.mjs:15`.
- Quest fallback and title substitution: `server.mjs:18`, `app.js:550`.
- Manager routes and shared upload dialog: `server.mjs:21`, `app.js:237`, `app.js:394`, `app.js:578`.
- Custom Blog UI: `app.js:602`; capture limitation: `README.md:41`.

## Scope-dependent omissions

- **Membership:** `/upgrade` returns 404, and navigation omits Membership. This is an intentional exclusion documented in `README.md:3`. Leave it excluded unless the scope changes to include it. The original [Membership page](https://500px.com/upgrade?hide_inactive=true) exists.
- **Additional account screens:** `/settings` and `/manager/statistics` return 404. These are outside the implemented public-page set. Include them only if the signed-in experience is part of the intended clone. 500px's [Stats FAQ](https://support.500px.com/hc/en-us/articles/115005524168-Stats-FAQ) documents the Statistics destination.
- **Other dynamic states:** ended-contest results/winners, account-specific panels, and other authenticated overlays still need reference inspection before claiming full site coverage. Their current live layouts were not accessible during this audit; they are not counted as independently confirmed missing designs.

## Already represented

- Category onboarding; For You, Fresh Picks, Editors' Choice, and weekly/monthly leaderboard.
- Quests hub, carousel, contest cards, filter dialog, and sample Juried/Battle details.
- Photo detail shell, Details/Comments tabs, photographer profile shell, Works/Galleries/Quests tabs.
- Licensing landing page, all seven guides, mobile table of contents, release PDFs, and Commercial Grants landing page.
- vivo campaign, app download, About Us, Terms, Privacy, and Licensing Agreement.
- Combined Sign up / Log in dialog, password recovery dialog, navigation menus, share/save dialogs, slideshow, upload preview, and Quest submission dialog.
- Search page shell; no detailed search review is included in the findings.

The combined authentication fragment explicitly says “Sign up / Log in.” A separate signup page is not a confirmed omission. Reusing photographer/photo templates with representative content is also not a missing UI page under the clarified scope.

## Verification and evidence

- All **29 manifest routes** loaded at **1440 × 900** and **390 × 900**: **58 page checks**, with no detected horizontal overflow, broken image elements, or uncaught JavaScript errors.
- **711 unique local href/src URLs** extracted from the manifest pages and home document returned successful HTTP responses. This does not include every JavaScript-generated route; the gallery route above is a confirmed exception.
- Existing `tools/browser-check.mjs` passed its 12 desktop pages, seven mobile layouts, and focused interaction assertions.
- `npm run lint` passed JavaScript syntax checks.
- Screenshots: [gallery placeholder](screenshots/audit/gallery.png), [Licensing Quest using the Battle layout](screenshots/audit/licensing-quest.png), [generic Quest detail](screenshots/audit/generic-quest.png), [combined authentication](screenshots/audit/signup.png).
- Raw audit results: `.reference/audit/results.json`, `.reference/audit/link-check.json`, and `.reference/audit/extra.json`. These and screenshots are ignored development artifacts.

Live visual comparison was blocked: local DNS resolved `500px.com` to localhost; a browser-only public-DNS override reached a connection reset. Web search supplied limited official-page evidence, but no usable live rendering. Consequently these checks establish local UI coverage and concrete placeholders, not pixel-level parity or a complete census of the current original site.

No application HTML, CSS, JavaScript, routes, or content were changed. Recommended UI order: gallery detail, Licensing Quest variant, reference-verified Blog, then manager/account screens if included.
