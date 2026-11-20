# ShopTogether web companion

The web project lives in `web/` within the existing `HeathenAZ/ShopTogether` repository. It connects directly to the **same** Supabase project as Android: `iwxifzcchleomnnkthev`. There is no separate account system, database, or copied household data.

Intended production address: **https://shop-together.app** (the user's purchased domain). The first hosted preview uses a private Sites address. The purchased domain has not been connected to hosting or DNS.

## Run locally

Requires Node 22.12+ or a supported newer version.

```powershell
cd web
npm ci
npm run dev
```

Open the printed local address and sign in with the **same email and password used on a phone**. Do not create a new account if you want existing household data. Localhost serves this computer; use the hosted preview for another device.

```powershell
npm test
npm run check
npm run build
```

Deploy `dist/` to an HTTPS static host. Use SPA fallback to `index.html`, immutable caching for hashed assets, and short/no caching for `index.html`. Never serve `.env`, repository metadata, or source credential files.

## Implemented

- Email/password sign-in, persistent Supabase sessions, sign-out, sign-up UI, and password recovery UI.
- Shopping list creation, owner editing and store assignment; household lists use existing database auto-sharing triggers.
- Detailed item creation/editing, check/uncheck, search/filter, quantities and estimated total. Barcode stays text so leading zeros survive. Fields include brand, category, aisle, price, package size, notes, image URL, and private image upload.
- Existing list roles are honored: owners manage lists/sharing; editors modify items; viewers read details.
- Stores: creation, owner editing, location, notes, private photos, and remembered aisles reconstructed from accessible synced item records for that store.
- Recipes: creation/editing, plain-text ingredients and instructions, description, servings, timings, category, favorite, rating, source link, image URL, private photo upload, and recipe details.
- **Import from website** on Recipes: reads public HTTPS recipe JSON-LD through the authenticated `import-recipe` Edge Function on the existing Supabase project, then opens editable details for review. Saving uses the same existing shared-recipes path/RLS as manual creation. Nothing is saved during extraction.
- Meal plans: seven-day view, Breakfast/Lunch/Dinner slots, recipe selection or custom meal titles, notes, editing, and removal.
- Account & Sharing: current account, partner list, existing `share_list_with_email` / `share_everything_with_email` RPCs, and leaving a shared list. Household sharing has an explicit explanatory confirmation screen.
- Responsive layout and browser-local light/dark/system preferences; current transparent Android banner copied unchanged into `public/`.
- A visible **Sync Everything** button reconnects realtime, reloads all accessible shared records, and refreshes signed photo URLs, with busy/success/error feedback. Web changes already save immediately; it cannot upload phone-local data remotely.
- List cover photos follow Android's precedence: custom list photo first, otherwise the assigned store's photo. Failed image signing is retryable and displayed as unavailable rather than permanently cached as blank.
- Supabase Postgres Changes subscriptions limited to the household tables, refresh after writes, reconnect/resume catch-up, and manual Sync Everything recovery. No timer repeatedly downloads unchanged household data.
- Private existing storage buckets use signed image URLs, refreshed before expiry. No buckets made public.
- Updates send changed fields with an observed `updated_at` comparison. If another client edits first, the save fails visibly and asks the user to reopen the record. No silent zero-row success.
- Deletes use `deleted_at` tombstones rather than hard deletes, matching Android sync.

## Compatibility and boundaries

Existing tables/RPCs/RLS/triggers/realtime publication/buckets are reused without alteration. Android files are unchanged. Recipe ingredients/instructions stay plain text. Meal identity is exactly `YYYY-MM-DD|Breakfast`, `|Lunch`, or `|Dinner`. Author/owner/group identifiers are not editable in the web UI.

There is no cloud aisle-preference table in the existing backend. Android reconstructs its local aisle memory from synced shopping items; the website does likewise. Aisle memory absent from accessible cloud item history cannot be recovered by the web project. This intentionally avoids inventing an incompatible cloud schema.

The website is online-first. It does not queue offline writes or claim that unsaved changes reached a phone. Android keeps its existing last-modified reconciliation; simultaneous offline Android edits can still participate in that pre-existing last-write-wins behavior. Phone-level conflict/sync testing remains necessary.

## Verification on October 11, 2026

- 16 automated tests passed: input safety, barcode/null-price preservation, Android meal keys, recipe text/rating, store-scoped aisle memory, viewer/editor roles, real SDK HTTP PATCH contract, timestamp conflict detection, permission-error propagation, tombstone deletion, compound meal keys, pagination, custom/store cover precedence, private store photo signing, and image-signing error propagation.
- Syntax checks and production build passed. Production dependency audit reported zero known vulnerabilities.
- Browser sign-in/sign-up navigation, light/dark toggle, desktop and 390px mobile sign-in layout checked. These checks did not submit account creation or password-reset emails.
- Live database read-only role checks: unrelated authenticated UUID returned zero rows for lists/items/stores/recipes/meals/members/groups/images; anonymous access to shopping lists returned permission denied; an existing member could read household data. No business data was changed for these checks.
- Inspected existing RLS policies, private authorization helper functions, RPC definitions/grants, private bucket policies, realtime publication, and timestamp/member/auto-share triggers.
- Actual signed-in browser writes, private image uploads, and two-phone end-to-end sync remain **unverified**. HTTP-boundary tests do not substitute for these checks.

## Security findings inherited from the backend

All eight public tables have RLS enabled. Existing sharing RPCs are not executable by `anon`; they check `auth.uid()` and use fixed empty search paths. The list-sharing RPC checks list ownership. Privileged sharing RPCs remain deliberately callable by authenticated users, so the Supabase advisor reports four warnings; they were reviewed and left unchanged to preserve Android behavior.

Leaked-password protection is disabled in the existing Auth configuration. Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Existing privileged-RPC advisor explanation: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Only the existing publishable browser key is included in `src/config.js`. It is not a secret or authorization bypass. No service-role key, account credentials, Android `local.properties`, or connector token belongs in web source/builds.

## Remaining setup and acceptance checks

1. Sign in using an existing phone account. Confirm its expected lists, recipes, images, meal plans, and partner appear.
2. Add a disposable test item on the website; confirm both phones see it. Change its checked state/notes on each phone and confirm the website updates. Repeat a recipe, meal slot and photo upload. Remove the disposable records after the test.
3. Use a viewer account and a separate unrelated account to verify write denial and isolation through the browser API. Read-only database checks already passed; no production write attempts were made under impersonated users.
4. In Supabase Auth URL Configuration, **preserve the Android callback** (`com.readygo.shoptogether://login-callback`) and add the exact hosted website origin, `http://127.0.0.1:5173`, and eventually `https://shop-together.app` to authorized redirect URLs. Set the intended website Site URL when deploying to the purchased domain. Sign-in with a password does not require a redirect; confirmation/recovery email links do.
5. Connect `shop-together.app` to an HTTPS host through the registrar's DNS using values supplied by the chosen host. The purchased domain alone is not web hosting. Do not invent DNS targets or remove unrelated mail/domain records.
6. Decide whether to enable leaked-password protection in the existing backend, then test sign-up/reset links against the final origin.
7. Optional future work: barcode camera scanning, offline web editing, list category ordering, household unlinking, and store deletion.

## Recipe ingredients to shopping lists — October 26, 2026

Open a recipe and choose **Add ingredients to list**. Select a list you own or can edit, review/edit the ingredient lines, untick pantry items, and add the selection. Exact matches already unchecked on that list are not selected by default. Checked items can be added again for a new shop. Section headings ending in a colon are also left unticked. Repeated source lines are retained because they may belong to different recipe steps.

Each selected line becomes a normal `shopping_items` row with quantity 1, the original amount/unit in its name, and a recipe note. This deliberately avoids guessing how cooking units translate into store package counts. Existing items, categories, prices, images, checked states, and phone edits are never overwritten. No database schema, RLS policy, or Android file changes are needed.

Saves use one batch request with stable IDs and conflict-ignore behavior. Retries reuse the same frozen selection; the client confirms every active item ID is readable on the destination list before reporting success. This protects against duplicate additions after a lost response and against overwriting later phone edits. Closing and starting a new addition is a separate operation.

All 30 automated tests and the production build passed, including batch retry/permission-denial/confirmation tests, ingredient text preservation, exact existing-item matching, and the existing realtime no-polling regression checks.

The signed-in hosted browser flow was verified on desktop and at 390px mobile width. With explicit user approval, two selected ingredients were saved to a temporary list; their amounts and recipe note were confirmed, and reopening the picker correctly skipped those existing unchecked items. Both test items and the temporary list were then soft-deleted through the UI. The regular lists were not used for the test. Physical two-phone observation remains a separate check.

## Website recipe imports

The endpoint source is in `web/supabase/functions/import-recipe/`. JWT verification is enabled and the handler also validates the current Supabase user. It performs no database writes and uses no service-role key. It supports schema.org Recipe objects, JSON-LD arrays/graphs, nested instruction sections, ingredients, images, categories, servings, and ISO cooking/prep durations. Missing ingredients/instructions are flagged for review. Publisher-wide aggregate ratings are not copied into the household's own rating field.

HTTPS targets are restricted to public DNS addresses, and each connection pins the validated IP while retaining TLS hostname verification. Redirects are revalidated, response size is capped at 2 MB, downloads time out, and allowed browser origins are restricted. A best-effort per-instance rate limit protects ordinary usage; it is not a distributed quota. Website login/paywall/bot restrictions are not bypassed. Some sites, including an Allrecipes page checked during development, return 403 to server imports; the UI reports this and the existing manual editor remains available.

On October 12, 2026, all 22 parser, security, and web tests passed. A public Budget Bytes recipe was extracted through the real downloader, and the deployed endpoint rejected an unauthenticated request with HTTP 401. Existing database schema, RPCs, policies, and Android files were unchanged.

For GitHub integration, the web-only changes are prepared on local branch `codex/shoptogether-web` based on the active Android `feature/list-details` checkout. They have not been pushed to GitHub or merged. Sites publication stores a hosting copy of the web source; the existing GitHub project remains the integration source.
