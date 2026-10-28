# UI verification

Run `npm start`, then open http://localhost:5000. For fresh onboarding, clear the `500px-local-demo` browser storage entry.

- [ ] Landing page shows eight original category photos on a dark background; Membership is absent.
- [ ] Selecting categories updates the count; a fifth selection is refused; Continue opens the feed.
- [ ] Inspiration opens a menu with For You, Fresh Picks, Editors' Choice, and Top Ranked.
- [ ] A photo opens a detail page with matching photography and a photographer panel.
- [ ] Grid-size controls resize photos without overlap; browser resizing keeps the feed within the viewport.
- [ ] Slideshow opens a photo viewer; arrows change photos; Escape closes it.
- [ ] Like, save to gallery, and follow states remain after reloading.
- [ ] Search accepts a query using Enter; orientation filters alter the visible results.
- [ ] Log in opens the original-style dialog; password visibility works; sample credentials create a demo session.
- [ ] Photo Details and Comments tabs switch content; a demo comment remains after reloading.
- [ ] Share opens a link dialog and Copy link copies the current local URL.
- [ ] Quests show both hero banners, three introductory cards, benefits, and 60 contest cards with local images.
- [ ] Banner arrows, dots, keyboard arrows, Sign up, and the vivo campaign link work; reduced motion stops automatic rotation.
- [ ] Juried shows two contests; Licensing shows 20; Battles and Free combine without resetting each other.
- [ ] Sort & Filter matches the original dialog; status, type, fee, difficulty, and category combine; Cancel/Escape discard changes.
- [ ] Default, Newest, Ending Soon, and Most Joined preserve their order after reload; Clear All and Confirm restore all cards.
- [ ] To Start shows the empty state for this snapshot; All restores results.
- [ ] At 390px, Quests show one card per row, a dismissible app banner, and a scrollable filter dialog with visible actions.
- [ ] A Quest opens its details; All Entries shows seeded photography; submission requires a demo session and a selected photo.
- [ ] Licensing opens all seven guides; guide anchors scroll to their relevant sections.
- [ ] Licensing dropdown links to About Licensing, Become a Contributor, Submission Requirements, Content Types, Content Distribution, and Commercial Grants.
- [ ] Each guide marks the current page; its sidebar links and next-guide link navigate to the correct local page.
- [ ] At 768px and below, Table of Contents starts collapsed; click/Enter opens it, Escape closes it, and all seven links work.
- [ ] At 390px, the app banner matches the reference; Close dismisses it and View opens Download.
- [ ] Model Release, Property Release, and Contributor Licensing Agreement open real local PDFs.
- [ ] Get started and Photo/Licensing Manager links open demo login while signed out and upload while signed in.
- [ ] The floating support control opens local guidance and Escape closes it.
- [ ] Commercial Grants shows five original project mosaics and credits; project links scroll to their sections and update the active item.
- [ ] Commercial Grants collection links open the corresponding live 500px galleries in a new tab.
- [ ] Photographer Works/Galleries/Quests tabs open their associated local content.
- [ ] Leaderboard shows its animated photo strip, gold/silver/bronze rank medals, large thumbnails, descriptions, photographer credits, and engagement controls.
- [ ] Weekly and Monthly show different captured titles, descriptions, and 50 correctly ordered rankings; switching back restores Weekly.
- [ ] Leaderboard likes and saved state remain after a reload; photo and photographer links open their corresponding local pages.
- [ ] vivo, Download, About Us, Terms, Privacy, and Licensing Agreement open without broken local images.
- [ ] At a 390px viewport, navigation and page content fit without horizontal scrolling.
- [ ] Browser console shows no uncaught JavaScript errors during these flows.
