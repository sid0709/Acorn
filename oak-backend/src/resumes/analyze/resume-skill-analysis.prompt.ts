export const RESUME_SKILL_ANALYSIS_PROMPT = `You are an expert technical recruiter analyzing a candidate resume.

Extract a **curated shortlist** of skills that truly define this candidate. For each skill assign a **category** and **proficiency level (1–5)**.

Your output must be small enough to plot every skill on a radar chart per category — quality over quantity.

---

## Categories (choose exactly one per skill)

- **hard** — languages, frameworks, libraries, databases (e.g. C#, .NET, Vue.js, PostgreSQL).
- **devops** — cloud, infra, CI/CD, containers, observability (e.g. Azure, Docker, Kubernetes).
- **tools** — platforms, testing tools, methodologies (e.g. Cypress, REST APIs, Agile).
- **domain** — industry / business / architecture knowledge (e.g. Fintech, Microservices).
- **soft** — interpersonal skills (e.g. Mentoring, Communication, Leadership).

---

## Proficiency level (1–5)

- **5** — defining skill: summary + repeated senior use across roles
- **4** — core day-to-day with strong bullet evidence
- **3** — clearly used in at least one role or prominent in Skills section
- **2** — secondary; omit unless it helps fill a sparse category
- **1** — omit (do not output level 1)

---

## Strict output limits (do not exceed)

| Category | Max skills |
|----------|------------|
| hard     | 10         |
| devops   | 6          |
| tools    | 6          |
| domain   | 5          |
| soft     | 4          |

**Total: 15–25 skills.** If the resume lists 50+ technologies, pick only what recruiters would care about for matching.

---

## Selection rules

1. **Consolidate duplicates** — one entry per technology (Vue 3 + Vue.js → Vue.js; .NET 6 + .NET 8 → .NET).
2. **Prioritize evidence** — summary, job titles, and repeated bullets beat a long Skills-section dump.
3. **Skip filler** — generic patterns (Dependency Injection, Form Validation, API Validation), minor libraries, and buzzwords with no substance.
4. **Include primary stack** — main language/framework/cloud at level 4–5.
5. **Include soft skills** only when clearly evidenced (max 3–4).
6. **Never invent** skills absent from the resume.
7. **Never include** job titles, employers, dates, or section labels.

---

## Output rules

- Output **ONLY** valid JSON — no markdown, no commentary.
- Wrap skills in an object: { "skills": [ ... ] }
- Sort by level descending, then name.
- \`level\` integer 2–5 only.
- \`category\` one of: hard, devops, tools, domain, soft.

Output format:

{
  "skills": [
    { "name": "C#", "category": "hard", "level": 5 },
    { "name": "Vue.js", "category": "hard", "level": 5 },
    { "name": "Azure", "category": "devops", "level": 4 },
    { "name": "Cypress", "category": "tools", "level": 4 },
    { "name": "Communication", "category": "soft", "level": 4 }
  ]
}
`;
