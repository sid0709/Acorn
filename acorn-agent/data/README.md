# Applicant data

The agent reads the applicant from this folder (or the folder named by `ACORN_AGENT_DATA_DIR`).
Nothing here is committed.

- `profile.json`: any JSON object describing the applicant. Acorn's own profile export works
  as it is (`{"_id": …, "profile": {…}}` is unwrapped). It is read at the start of every run,
  so an edit applies to the next run without restarting the server.
  - The model never sees `openrouterApiKey`, `openaiApiKey`, `extensionPassword`, `resumeFolderPath`, or the
    database's `_id`, `accountId`, `updatedAt`, `createdAt`. Add more names, comma separated, to
    `ACORN_AGENT_PROFILE_HIDE`.
  - `defaultAccountPassword` is shown to the model only as `{{account_password}}`. When it types
    that, the server types the password instead, so it is in no prompt and no trace.
  - Empty values are left out, so "not in the profile" reads as absent.
  - If the server has no `OPENROUTER_API_KEY`, it uses `openrouterApiKey` from here.
  - With an `openaiApiKey` here, the model that drives the run is called on OpenAI directly (no OpenRouter request cap),
    billed to that key; the checks and choices stay on the OpenRouter key.
- `resumes/`: the files the agent may upload (`.pdf`, `.doc`, `.docx`, `.rtf`, `.txt`).
  - **A folder is one résumé**, and its files are the formats it comes in
    (`resumes/C# + React/Name.pdf` and `Name.docx`). The folder name says what the résumé is
    for; the agent picks the folder that fits the job and sends the PDF unless the page needs
    another format.
  - **A file directly in `resumes/`** is some other document (`Cover Letter.pdf`). It is only
    uploaded when the page asks for that kind of document, and is never chosen as the résumé.
