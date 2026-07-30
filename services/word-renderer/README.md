# Microsoft Word PDF Renderer

Stealth uses Microsoft Graph only for exact-format DOCX-to-PDF rendering. The
original and tailored DOCX files are rendered by the same Microsoft Word engine,
then compared before a PDF is returned.

## Microsoft 365 setup

1. Create a dedicated SharePoint site or OneDrive drive for temporary resume
   conversion. Do not use a drive that contains unrelated files.
2. Create a folder in that drive for Stealth's temporary DOCX files.
3. Register an application in Microsoft Entra ID.
4. Add the Microsoft Graph application permission `Files.ReadWrite.All`.
5. Grant tenant admin consent.
6. Prefer an application access policy that limits the app to the dedicated
   site or drive.
7. Create a client secret and store it only in server environment variables.

## Required environment variables

```bash
MS_GRAPH_TENANT_ID=
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=
MS_GRAPH_DRIVE_ID=
MS_GRAPH_FOLDER_ID=
```

`MS_GRAPH_FOLDER_ID` is the item id of the dedicated temporary folder, not its
display name.

## Runtime behavior

`POST /api/resume/tailor/pdf`:

1. Downloads the authenticated user's original DOCX from private Supabase
   storage.
2. Applies approved text-only edits while preserving the DOCX package.
3. Uploads a random temporary filename to the dedicated Microsoft drive.
4. Requests Graph's native `content?format=pdf` conversion.
5. Permanently deletes the temporary DOCX in a `finally` block.
6. Compares the original and tailored Word-rendered PDFs.
7. Returns the PDF only when the fidelity receipt passes.

Document text, filenames, Graph download URLs, and contact details are never
logged. A cleanup failure blocks the export rather than leaving a temporary file
unreported.

## Verification

Run the offline DOCX fidelity test:

```bash
npm run test:resume-fidelity
```

Then configure a private fixture drive and manually verify a real stored DOCX
through the tailoring workspace. The response must include
`X-Stealth-PDF-Verified: 1`.
