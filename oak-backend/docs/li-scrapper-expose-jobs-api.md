# LI-scrapper → Athens API (save job → `temp_jobs`)

Handoff guide for the LI-scrapper team. Point the extension at **Athens VPS**, not the old Sid host.

## Compatibility status (current LI-scrapper in this repo)

| Item                                                    | Status           | Notes                                                            |
| ------------------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| Request body field names                                | OK               | Matches `prenormLiScrapePayload`                                 |
| Required fields / validation                            | OK               | Same rules the server enforces                                   |
| Response handling (`success` / `created` / `duplicate`) | OK               |                                                                  |
| Check-exists (`jobID` → `exists`)                       | OK               |                                                                  |
| **Base host**                                           | **Needs update** | Still `https://sid.remotepairnet.net` — must be Athens VPS below |
| Storage target                                          | OK on Athens     | `POST` → prenorm → dedupe → Mongo **`temp_jobs`**                |

No LI-scrapper code was changed in this pass. Only the **host** needs updating on their side.

---

## Base URL (VPS)

```
https://athens.remotepairnet.net
```

Global API prefix: `/api`

| Purpose                     | Method | Full URL                                                 |
| --------------------------- | ------ | -------------------------------------------------------- |
| Save / ingest job(s)        | `POST` | `https://athens.remotepairnet.net/api/expose/jobs`       |
| Check if job already exists | `POST` | `https://athens.remotepairnet.net/api/expose/jobs/check` |

**Config change for LI-scrapper:**

```js
// BEFORE (old)
var API_ENDPOINT = 'https://sid.remotepairnet.net/api/expose/jobs';
var CHECK_API_ENDPOINT = 'https://sid.remotepairnet.net/api/expose/jobs/check';

// AFTER (Athens VPS)
var API_ENDPOINT = 'https://athens.remotepairnet.net/api/expose/jobs';
var CHECK_API_ENDPOINT =
  'https://athens.remotepairnet.net/api/expose/jobs/check';
```

Auth: none on these routes (public ingest).  
Headers:

```http
Content-Type: application/json
```

---

## 1. Save job — `POST /api/expose/jobs`

Accepts either a **single job object** or a **batch** `{ "jobs": [ ... ] }`.

### Exact JSON form (single job) — what LI-scrapper already sends

```json
{
  "sender": "li-job-scraper",
  "companyName": "Acme Corp",
  "companyIcon": "https://media.licdn.com/dms/image/....",
  "jobTitle": "Senior Software Engineer",
  "jobDescription": "Full job description text…",
  "jobLink": "https://boards.greenhouse.io/acme/jobs/123",
  "source": "linkedin",
  "postedAt": "2 days ago",
  "jobID": "linkedin-1234567890"
}
```

### Field contract

| Field            | Required                  | Type                    | Notes                                                                                                                                                                                          |
| ---------------- | ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sender`         | **yes**                   | string                  | Provenance / `createdBy` in DB. Current value: `"li-job-scraper"`. Aliases: `Sender`.                                                                                                          |
| `companyName`    | **yes**                   | string                  | Aliases: `company_name`.                                                                                                                                                                       |
| `jobTitle`       | **yes**                   | string                  | Aliases: `job_title`, `title`.                                                                                                                                                                 |
| `jobDescription` | **yes**                   | string                  | Aliases: `job_description`, `description`. Non-empty after trim.                                                                                                                               |
| `jobLink`        | **yes**                   | string (http/https URL) | Apply / offsite URL. Aliases: `job_link`, `applyLink`, `url`. Must pass `^https?://`.                                                                                                          |
| `companyIcon`    | no                        | string (http/https URL) | Company logo. Aliases: `company_icon`. Stored as `metadata.companyLogo`.                                                                                                                       |
| `source`         | no                        | string                  | e.g. `"linkedin"` from LI-scrapper. Stored on ingest as sent; **Title Review / AI Analyze** rewrite `source` from `jobLink`/`applyLink` via `inferJobSource` (Greenhouse, Ashby, LinkedIn, …). |
| `postedAt`       | no                        | string                  | Relative scrape text (`"2 days ago"`, `"3 hours ago"`, …). Also accepted as `postedAgo` / `posted_ago`. Parsed into absolute `postedAt`; raw string kept as `postedAgo`.                       |
| `jobID`          | no (strongly recommended) | string                  | Dedup key → `metadata.legacyId`. Current convention: `"linkedin-" + digits`. Aliases: `job_id`, `jobId`.                                                                                       |

Empty strings are treated as missing. Unknown fields are ignored (no strict whitelist reject).

### Batch form (optional)

```json
{
  "jobs": [
    {
      "sender": "li-job-scraper",
      "companyName": "…",
      "jobTitle": "…",
      "jobDescription": "…",
      "jobLink": "https://…",
      "jobID": "linkedin-1"
    },
    {
      "sender": "li-job-scraper",
      "companyName": "…",
      "jobTitle": "…",
      "jobDescription": "…",
      "jobLink": "https://…",
      "jobID": "linkedin-2"
    }
  ]
}
```

Empty `jobs: []` → HTTP **400**.

### Success responses

**Created** — HTTP **201**

```json
{
  "success": true,
  "created": true,
  "duplicate": false,
  "id": "<mongo ObjectId hex>",
  "jobID": "linkedin-1234567890",
  "jobLink": "https://boards.greenhouse.io/acme/jobs/123",
  "source": "linkedin"
}
```

**Duplicate** (already in `temp_jobs` or `jobs`) — HTTP **200** (not an error)

```json
{
  "success": true,
  "created": false,
  "duplicate": true,
  "id": "<existing id if known>",
  "jobID": "linkedin-1234567890",
  "jobLink": "https://…",
  "reason": "…",
  "code": "…"
}
```

Dedupe matches when any of:

1. `metadata.legacyId` equals `jobID`
2. Same `applyLink` (`jobLink`) within the dedupe window (default **14** days)
3. Same normalized `companyName` + `title` within that window

**Batch success** — HTTP **201**

```json
{
  "success": true,
  "created": 1,
  "duplicates": 1,
  "results": [/* per-job SaveJobResult objects */]
}
```

### Error responses

HTTP **400**

```json
{ "success": false, "error": "jobTitle is required" }
```

Typical `error` strings:

- `Request body must be a JSON object`
- `sender is required`
- `companyName is required`
- `jobTitle is required`
- `jobDescription is required`
- `jobLink is required`
- `jobLink must be a valid http(s) URL`
- `companyIcon must be a valid http(s) URL when provided`
- `jobs array cannot be empty`
- `jobs[N]: <same validation message>`

---

## 2. Check exists — `POST /api/expose/jobs/check`

### Request

```json
{
  "jobID": "linkedin-1234567890"
}
```

Aliases for the id field: `job_id`, `jobId`.

### Response — HTTP **200**

```json
{ "success": true, "exists": true }
```

or

```json
{ "success": true, "exists": false }
```

Looks up `metadata.legacyId` in **`temp_jobs` and `jobs`**.

Missing `jobID` → HTTP **400**:

```json
{ "success": false, "error": "jobID is required" }
```

---

## What lands in Mongo `temp_jobs`

Server maps the scrape body into a staging row (not the searchable `jobs` catalog). Job Search only reads `jobs` after Title Review + AI Analyze promote the row.

| `temp_jobs` field         | Source                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| `title`                   | `jobTitle`                                                               |
| `companyName`             | `companyName`                                                            |
| `source`                  | `source` (ingest); rewritten from apply URL at Title Review / AI Analyze |
| `postedAt`                | parsed from `postedAt` / `postedAgo` (else now)                          |
| `postedAgo`               | raw relative string when provided                                        |
| `description`             | `jobDescription`                                                         |
| `applyLink`               | `jobLink`                                                                |
| `createdBy`               | `sender`                                                                 |
| `titleReviewLabel`        | always `"PENDING"` on ingest                                             |
| `aiSkillStatus`           | always `"pending"` on ingest                                             |
| `sourceCatalog`           | always `"external"` on ingest                                            |
| `model_schema_code`       | server constant (e.g. `mongodb-athens-2026-08-06`)                       |
| `metadata.legacyId`       | `jobID`                                                                  |
| `metadata.companyLogo`    | `companyIcon`                                                            |
| `createdAt` / `updatedAt` | server                                                                   |

---

## curl examples (Athens VPS)

```bash
# Check
curl -sS -X POST 'https://athens.remotepairnet.net/api/expose/jobs/check' \
  -H 'Content-Type: application/json' \
  -d '{"jobID":"linkedin-1234567890"}'

# Save
curl -sS -X POST 'https://athens.remotepairnet.net/api/expose/jobs' \
  -H 'Content-Type: application/json' \
  -d '{
    "sender": "li-job-scraper",
    "companyName": "Acme Corp",
    "jobTitle": "Senior Software Engineer",
    "jobDescription": "Build things.",
    "jobLink": "https://boards.greenhouse.io/acme/jobs/123",
    "source": "linkedin",
    "postedAt": "2 days ago",
    "jobID": "linkedin-1234567890",
    "companyIcon": "https://media.licdn.com/dms/image/example.png"
  }'
```

---

## Implementation pointers (Athens)

| Piece           | Location                                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| HTTP routes     | `athens-backend/src/jobs/expose-jobs.controller.ts`                                   |
| Body → TempJob  | `athens-backend/src/jobs/mappers/prenorm-scrape.mapper.ts` → `prenormLiScrapePayload` |
| Dedupe + insert | `athens-backend/src/jobs/save-job.service.ts`                                         |
| Collection      | Prisma `TempJob` → Mongo `temp_jobs`                                                  |
