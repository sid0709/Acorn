package resume

// Defaults for a step saved with a blank prompt or schema. The system message holds the candidate's
// profile, so these ask for the writing and name only what changes per posting.
var defaultPrompt = map[string]string{
	"summary": `Write a 3-4 sentence professional summary for this candidate tailored to the job.

Job description:
{job_description}

Write in first person implied (no "I"). Tight, specific, ATS-friendly. Use the candidate's real background. Do not invent employers.`,

	"skills": `Group this candidate's skills into 3-6 categories that match the job. Prefer skills evidenced in their history.

Candidate careers:
{career}

Job description:
{job_description}

Name skills the way the posting does. Do not list a skill the candidate's history gives no sign of.`,

	"experience": `Rewrite each role as achievement bullets tailored to the job. Keep company names and dates. 3-5 bullets per role. Quantify when the source allows; otherwise stay concrete.

Candidate careers:
{career}

Job description:
{job_description}

Write in first person implied (no "I"). Weave the posting's skills into concrete tasks, not keyword lists.`,
}

var defaultSchema = map[string]string{
	"summary": `{
  "type": "object",
  "additionalProperties": false,
  "properties": { "summary": { "type": "string" } },
  "required": ["summary"]
}`,
	"skills": `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "category": { "type": "string" },
          "items": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["category", "items"]
      }
    }
  },
  "required": ["skills"]
}`,
	"experience": `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "experiences": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "company": { "type": "string" },
          "title": { "type": "string" },
          "period": { "type": "string" },
          "bullets": { "type": "array", "minItems": 1, "items": { "type": "string" } }
        },
        "required": ["company", "title", "bullets"]
      }
    }
  },
  "required": ["experiences"]
}`,
}
