# acorn-agent

The server behind Acorn's agent Run. The Chrome extension is the agent's eyes and hands: it
sends a screenshot of the page, this server answers with the next mouse and keyboard actions,
and the extension performs them. The server keeps the run's memory and decides when it is
done, needs the person, or is stuck.

It has no database. The applicant is `data/profile.json` and the files in `data/resumes/`
(see [data/README.md](data/README.md)). It listens on this machine only.

```bash
cp acorn-agent/.env.example acorn-agent/.env   # add OPENROUTER_API_KEY
bun run dev:acorn-agent
bun run build:acorn                              # then load acorn/extension/dist, press Run
```

- Models: GPT-6 Luna (`openai/gpt-6-luna`) drives each step from the screenshot; TypeSafe Jev
  chooses which résumé to upload. Both go through OpenRouter on `OPENROUTER_API_KEY`.
- Each run is recorded under `traces/<session>/`: per step the screenshot the model saw, the same
  screenshot with every click drawn on it (`NNN.marked.jpg`), what the model was sent and answered
  (`NNN.model.json`), and a `timeline.txt` to read the run at a glance. Typed secrets are never
  written. `ACORN_AGENT_TRACE=false` turns this off.
- How it works: [docs/architecture/extension.md](../acorn/docs/architecture/extension.md), §19.
- Tests: `go test ./acorn-agent/...` and `bun run e2e:agent` (a real browser, the real server,
  and a stand-in for the model).
