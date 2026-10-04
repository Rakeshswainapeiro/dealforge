# W6-04 - Internal vs shared comments: visibility flag keeps internal notes out of subsidiary reads (AUD-03)

Accept criterion: *internal comments are never visible to subsidiary roles.*

## What this delivers
A clarification thread - and every message on it - carries a visibility of
`shared` or `internal`. An internal comment belongs to the group investment
layer: it is filtered out of every read and every notification for a
subsidiary-only user, so an internal note is never visible to a subsidiary role.

The restriction is enforced server-side, not in the client. A subsidiary-only
user never receives an internal thread in their inbox, is refused with 403 if
they request one by id, does not see internal messages inside a shared thread,
and is never notified about an internal comment. An internal thread is also kept
out of the audit read for such a user. A subsidiary-only author cannot create an
internal thread or mark a reply internal in the first place: the request is
refused rather than silently downgraded, so an author can never believe a comment
is internal when it is not.

## Where it lives
- Config (pure): `server/config/commentVisibility.js`, `server/config/commentVisibilityData.js`
- API: `server/commentVisibility.js` - GET/PUT `/api/comment-visibility` (config, defaults, visibilities and the caller viewer block; writes admin-only) and GET history
- Enforcement: `server/qa.js` - every read (listThreads, getThread, myThreads, the audit route) filters by visibility; openThread and addMessage stamp the effective visibility and refuse an internal comment from a subsidiary-only author; recipientsWhoMaySee() drops subsidiary recipients from internal notifications
- Storage: `qa_thread.visibility` and `qa_message.visibility` (default `shared`, so existing rows are unchanged)
- UI: Settings -> Comment Visibility tab; the Q&A page and the opportunity route show an Internal badge and offer the internal toggle only when the viewer may keep a comment internal

## How to reproduce
1. Demo stack: docker compose -p dealforge-demo -f docker-compose.demo.yml up -d --build -> http://localhost:34010
2. As admin, open Settings -> Comment Visibility: the group-layer restriction switch, the subsidiary roles it covers and the default visibility. Saving mints CVD-01.N.
3. As the Infinia deal lead (deal.lead@infinia.local, a subsidiary role), open Q&A: the shared thread Clarify the custody licensing timeline is present; the internal thread does not appear at all, and requesting it by id returns 403.
4. As the CIO (cio@sirius.local, group layer), open Q&A: the internal thread is listed with an Internal badge and its replies.

## Evidence
- admin_comment_visibility_policy_admin.png - the maintained policy: the group-restriction switch, the subsidiary roles it covers and the default visibility.
- preparer_internal_thread_hidden_subsidiary.png - a subsidiary deal lead inbox: only the shared thread is present; the internal thread is absent.
- analyst_internal_thread_visible_group.png - the group investment layer sees the internal thread, its Internal badge and the internal-only replies.

## Tests
- server/tests/commentVisibility.test.js - 11 unit tests (defaults, validation, revision minting, the subsidiary-viewer test, the visibility gate, effective message visibility).
- server/tests/m6.test.js - integration: reader sees the policy + viewer block, deal lead PUT is refused (403), an admin edit mints a revision + history, an internal thread is never visible to a subsidiary role across list / inbox / detail / reply / audit and raises no notification, a subsidiary author cannot create an internal thread (403), and a shared thread with an internal message filters that message out for the subsidiary viewer.
