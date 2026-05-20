# BlueAgent — Claude Code Guide

## What this project is

A multi-agent AI platform. `server.js` is the orchestrator: it reads agent configs from `agents/*.yaml` at startup and uses an LLM to route every `/api/chat` request to the right agent(s). Each agent runs a MISSION → EXECUTE → EVALUATE loop with persistent memory. The React frontend (`src/`) is a futuristic-themed chat UI.

## Dev commands

```bash
npm run dev      # starts both servers concurrently (Express :3001 + Vite :5173)
npm run server   # Express API only
```

The Vite dev server proxies `/api/*` to `http://localhost:3001`, so the React app never needs the API URL directly.

## Key files

| File | Role |
|---|---|
| `server.js` | Express API + LLM orchestrator — entry point for all chat requests |
| `agentLoader.js` | Reads `agents/*.yaml`, merges `skills/*.md` into system prompts, caches registry |
| `agentRunner.js` | MISSION/EXECUTE/EVAL loop, memory read/write, tool invocation (JS + Python) |
| `researchWorkflow.js` | LangGraph pipeline: researcher → writer → evaluator with revision loop |
| `agents/*.yaml` | One file per agent — name, description, skills, tools, mission, expected, evaluator config |
| `skills/*.md` | Behavioral guidelines appended to agent system prompts |
| `tools/*.js` / `tools/*.py` | Callable tools — JS exports `invoke()`, Python reads stdin JSON and writes stdout JSON |
| `memory/` | Auto-generated lesson files written after eval failures, read back on every agent call |
| `src/App.jsx` | React router shell — sidebar navigation for Dashboard, Agents, Skills, Incidents, Analytics, Reports, Settings |
| `src/components/` | One file per page — Dashboard, Agents, Skills, Incidents, Analytics, Reports, Settings |
| `.env` | All secrets — Azure OpenAI, Tavily, threat intel API keys |

## Architecture rules to follow

**Adding an agent:** create `agents/<name>.yaml` and restart the server. No code changes needed. The orchestrator discovers it automatically via `agentLoader.js`.

**Adding a skill:** create `skills/<name>.md`, add the name (without `.md`) to the agent's `skills:` list.

**Adding a tool:** create `tools/<name>.js` (exporting `invoke()`) or `tools/<name>.py` (stdin/stdout JSON contract), add the name to the agent's `tools:` list.

**Agent YAML required fields:** `name`, `display_name`, `description`. `system_prompt` is optional — `agentLoader.js` synthesises one from `mission` + `expected` if omitted. The `mission`, `expected`, and `evaluator` block (with `criteria`, `threshold`, `max_retries`) power the eval loop; omit the evaluator block to skip evaluation entirely (e.g. `skill_analyzer`). The `criteria` field should use named sub-criteria with explicit point allocations (`**Name (X–Y pts)**`) and a hard `Fail (score ≤N)` line — the evaluator returns a structured `critique` field that is injected into the retry prompt.

**The eval loop lives entirely in `agentRunner.js`** — `runAgent()` and `runPipelineAgent()` are the two public exports. Do not bypass them by calling the LLM directly inside an agent workflow unless there's a specific reason (the research workflow's evaluator node uses structured output and is the documented exception).

## Module system

`package.json` has `"type": "module"` — all `.js` files use ES module syntax (`import`/`export`). Dynamic tool imports use `pathToFileURL` to handle Windows paths correctly.

## Environment variables

All resolved from `.env` via `dotenv/config` (imported at the top of `server.js`). The Azure OpenAI config is spread into all model instantiations as `BASE_MODEL` / `MODEL_CONFIG`. If `AZURE_OPENAI_DEPLOYMENT_CHAT` is empty, falls back to `AZURE_OPENAI_DEPLOYMENT`.

## Frontend ↔ API contract

`POST /api/chat` receives `{ messages: [{role, text, images?: string[]}] }` where `images` is an optional array of base64 data URLs (e.g. `data:image/png;base64,...`). The body limit is 20 MB. Returns:
```json
{ "reply": "...", "agent": "comedian", "agentLabel": "Laughbot", "agents": [...], "iterations": 2 }
```
`agentLabel` drives the label shown in the chat bubble. `agents` (array) shows the chain in the `msg-meta` badge. `iterations` shows how many eval cycles ran.

## LangGraph research pipeline

`researchWorkflow.js` compiles a `StateGraph` at module load time. The `writer` node calls `runPipelineAgent()` (gains the eval loop + memory). The `evaluator` node uses `.withStructuredOutput()` directly — it does not go through `runPipelineAgent` because it returns structured JSON, not prose.

## Patterns to preserve

- **Agent registry is cached** in `agentLoader.js` (`_cache`). Call `invalidateRegistry()` if you need a hot-reload during development.
- **Memory files are managed automatically** — new files are created per lesson event; `writeMemory()` prunes the oldest beyond 10 per agent. Never modify or delete them by hand.
- **Tool errors bubble up** — `invokeTool()` rejects on non-zero exit or invalid JSON; callers should handle or let it surface as a 500.
- **Orchestrator uses `z.enum`** for workflow types — if you add a new workflow type, update both the `OrchestratorDecision` zod schema in `server.js` and the routing switch.

## Things to avoid

- Do not import `dotenv/config` in any file other than `server.js` — it is the process entry point.
- Do not hardcode agent names or intent keywords in `server.js` — routing is entirely LLM-driven via the registry descriptions.
- Do not modify or manually delete `memory/*.md` files — they are written and pruned automatically by `agentRunner.js`.
- Do not add API keys to any file that is not `.env`.
- Do not bypass the `skill_analyzer` check when installing external skills — it is the only security gate against prompt-injection payloads arriving via skill files.
