# acorn-agent

The server behind Acorn's agent Run. The Chrome extension is the agent's eyes and hands: it
sends a screenshot of the page, this server answers with the next mouse and keyboard actions,
and the extension performs them. The server keeps the run's memory and decides when it is
done, needs the person, or is stuck.

It has no database. Who it applies as comes from one of two places:

- **acorn-backend** (production; set `ACORN_AGENT_BACKEND_URL`): the signed-in person's own profile and
  Library. The extension sends their Acorn session with each run; the agent keeps it for that run only
  and asks the backend (`GET /acorn/agent/applicant`, `GET /acorn/agent/resumes/:id`). To try it
  locally, run acorn-backend and set `ACORN_AGENT_BACKEND_URL=http://127.0.0.1:8083`.
- **Files** (development; the default): `data/profile.json` and the files in `data/resumes/`
  (see [data/README.md](data/README.md)).

Locally it listens on this machine only. In production it is the `acorn-agent` image, deployed with
the rest (see [deploy/README.md](../deploy/README.md)).

```bash
cp acorn-agent/.env.example acorn-agent/.env   # add OPENROUTER_API_KEY
bun run dev:acorn-agent
bun run build:acorn                              # then load acorn/extension/dist, press Run
```

- Models: GPT-6 Luna (`openai/gpt-6-luna`) drives each step from the screenshot and plans a whole
  screen at a time; GPT-6 Luna Decisions (`openai/gpt-6-luna-decisions`, input tokens only) checks
  the screen between the runs of a plan so Luna need not look at every one; TypeSafe Jev chooses
  which résumé to upload. All go through OpenRouter on `OPENROUTER_API_KEY`. The checks are on by
  default; `ACORN_AGENT_CHECKS=false` turns them off.
- What a run cost and where its time went: `go run -C acorn-agent ./cmd/tracesum traces/<session>`.
- Each run is recorded under `traces/<session>/`: per step the screenshot the model saw, the same
  screenshot with every click drawn on it (`NNN.marked.jpg`), what the model was sent and answered
  (`NNN.model.json`), and a `timeline.txt` to read the run at a glance. Typed secrets are never
  written. `ACORN_AGENT_TRACE=false` turns this off.
- How it works: [docs/architecture/extension.md](../acorn/docs/architecture/extension.md), §19.
- Tests: `go test ./acorn-agent/...` and `bun run e2e:agent` (a real browser, the real server,
  and a stand-in for the model).
