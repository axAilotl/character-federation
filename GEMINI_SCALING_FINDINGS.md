# Gemini Code Review Findings: Scaling & Efficiency

## 🛑 Critical Performance & Data Issues

### 1. Missing Edge Caching
*   **Impact:** **High Cost & Latency.** Every API request hits the D1 database directly.
*   **Issue:** `GET /api/cards` (list) and `GET /api/cards/[slug]` (detail) have no `Cache-Control` headers.
*   **Solution:** Add `Cache-Control` headers to these endpoints.
    *   List: `s-maxage=60` (1 min)
    *   Detail: `s-maxage=300` (5 min)

### 2. Broken Transactions on D1
*   **Impact:** **Data Corruption.** D1 does not support standard SQL transactions like SQLite.
*   **Issue:** The `getAsyncDb` wrapper for D1 just runs functions sequentially. Concurrent votes/favorites will cause race conditions and incorrect counts.
*   **Solution:** Refactor `voteOnCard` and `toggleFavorite` to use D1's `db.batch()` API where possible, or accept eventual consistency.

### 3. Unscalable Search
*   **Impact:** **Slow Queries.** The fallback `LIKE` search causes full table scans.
*   **Issue:** `getCards` falls back to `LIKE %query%` which bypasses indexes.
*   **Solution:** For now, rely on the FTS index (already implemented locally, but needs D1 support via external service or careful D1 FTS usage if available).

### 4. Expensive Sorting (Trending)
*   **Impact:** **High CPU/DB Load.**
*   **Issue:** "Trending" sort calculates a score for *every row* in the DB on every request:
    `((upvotes - downvotes) + ...) * (1.0 / (1 + ((unixepoch() - created_at) ...)))`
*   **Solution:** Pre-calculate a `trending_score` column and update it via a scheduled worker (CRON), or simplify the query.

---

## 📋 Action Plan (Scaling)

1.  **Add Caching Headers:** Immediate high-impact fix for `api/cards` and `api/cards/[slug]`.
2.  **Fix D1 Transactions:** Update `voteOnCard` to be safe for D1.
3.  **Optimize Trending Sort:** Simplify the SQL query for now to avoid full table scans.
