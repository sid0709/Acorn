package resume

const (
	systemWriter = "You are an expert resume writer. Return only JSON that matches the schema. Write in first person implied (no I). Tight, specific, ATS-friendly."

	summaryPrompt = `Write a 3-4 sentence professional summary for this candidate tailored to the job.

Candidate:
{identity}

Job description:
{job_description}

Use the candidate's real background. Do not invent employers.`

	skillsPrompt = `Group this candidate's skills into 3-6 categories that match the job. Prefer skills evidenced in their history.

Candidate:
{identity}

Job description:
{job_description}`

	experiencePrompt = `Rewrite each role as achievement bullets tailored to the job. Keep company names and dates. 3-5 bullets per role. Quantify when the source allows; otherwise stay concrete.

Candidate careers:
{identity}

Job description:
{job_description}`
)

var purposeSchema = map[string]string{
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

var purposePrompt = map[string]string{
	"summary":    summaryPrompt,
	"skills":     skillsPrompt,
	"experience": experiencePrompt,
}
