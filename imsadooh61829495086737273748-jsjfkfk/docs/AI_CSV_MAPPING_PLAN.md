# AI Smart CSV Import Plan

## Overview
Enable users to upload any CSV format. An AI agent will analyze the headers and sample data to automatically map columns to our `leads` schema.

## Architecture

### 1. API Endpoint: `/api/leads/smart-map`
*   **Input**: `file` (multipart/dict) or `headers` (JSON array).
*   **Process**:
    1.  Extract CSV headers and first 3 rows of data.
    2.  fetch `leads` table schema (target).
    3.  **AI Prompt**:
        ```text
        You are a data mapping expert.
        Target Schema: {valid_fields: ["name", "email", "phone", "company", "linkedin_url", ...]}
        User CSV Headers: ["Contact Name", "E-mail Addr", "Cell", "Org"]
        User Data Samples: [...]

        Task: Map User CSV headers to Target Schema.
        Return JSON: { "Contact Name": "name", "E-mail Addr": "email" ... }
        ```
    4.  Return the mapping to the UI.

### 2. Frontend Review
*   Display the AI's suggested mapping.
*   Allow user to override/correct.
*   "Import" button sends the `file` + `confirmed_mapping` to `/api/leads/import`.

### 3. Implementation Steps
1.  Backend: `server/lib/ai/csv-mapper.ts` (New module).
2.  Route: `server/routes/prospecting.ts` (Add `/smart-import`).
3.  UI: Update `LeadsUploadModal` to support this flow.
