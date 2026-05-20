# BlueAgent

A multi-agent AI platform with a futuristic UI. BlueAgent acts as an orchestrator — it reads a registry of specialist agents defined in YAML, routes every user request to the right agent(s), and each agent runs a self-evaluating MISSION → EXECUTE → EVALUATE loop before returning a result. Agents accumulate lessons in a persistent memory store.

---

## Architecture

```
Browser (React/Vite :5173)
        │  POST /api/chat  { messages: [{role, text, images?}] }
        ▼
  Express API (:3001)  [20 MB body limit for image uploads]
        │
  ┌─────▼──────────────────────────────────────────────┐
  │  Orchestrator (LLM)                                │
  │  Reads agent registry → picks agent(s) + workflow  │
  └──────┬─────────────────────────────────────────────┘
         │
  ┌──────▼──────────────────────────────────────────────────────────────┐
  │  agentRunner.js  —  MISSION / EXECUTE / EVALUATE loop              │
  │                                                                     │
  │  1. loadMemory(agentName)   ← last 5 of memory/{agent}_*.md        │
  │  2. Build system prompt: skills + mission + expected + memory       │
  │  3. Run LLM  (with tool-use loop if agent has tools)               │
  │  4. Evaluate output — structured result:                            │
  │       score (1–10)  ·  passed (bool)  ·  feedback (string)         │
  │       critique (sub-criteria breakdown, failing attempts only)      │
  │     ├─ score ≥ threshold → return result                            │
  │     │    └─ if retried before → writeMemory() (lesson learned)      │
  │     └─ score < threshold  → inject feedback + critique, retry       │
  │          └─ max_retries hit → return best, writeMemory(warning)     │
  │                                                                     │
  │  writeMemory() caps lesson files at 10 per agent (deletes oldest)  │
  └─────────────────────────────────────────────────────────────────────┘
```

### Directory layout

```
agents/          YAML config files — one file = one registered agent
skills/          Markdown behavioral guidelines mixed into agent system prompts
tools/           JS or Python scripts (stdin JSON → stdout JSON)
memory/          Auto-written lesson files from the eval loop
src/             React frontend (Vite) — multi-page app
  App.jsx        Router shell + sidebar navigation
  components/    Dashboard, Agents, Skills, Incidents, Analytics, Reports, Settings
agentLoader.js   Reads & caches the agent registry at startup
agentRunner.js   MISSION/EXECUTE/EVAL loop, memory read/write, tool invocation
server.js        Express API + LLM orchestrator
```

---

## Prerequisites

- Node.js 20+
- Python 3.9+ (for Python-based tools)
- Azure OpenAI deployment (GPT-3.5-turbo or better with function calling)
- Tavily API key — free tier at [tavily.com](https://tavily.com) (for web research)

---

## Setup

```bash
git clone <repo>
cd BlueAgent
npm install
```

Copy `.env` and fill in your keys:

```env
# Required
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_DEPLOYMENT=<deployment-name>

# Required for web research
TAVILY_API_KEY=tvly-<key>

# Required for threat intelligence tools
VIRUSTOTAL_API_KEY=<key>
ALIENVAULT_OTX_API_KEY=<key>
ABUSEIPDB_API_KEY=<key>
NVD_API_KEY=<key>

# Required for Azure Sentinel tool
AZURE_TENANT_ID=<tenant>
AZURE_CLIENT_ID=<client>
AZURE_CLIENT_SECRET=<secret>
AZURE_WORKSPACE_ID=<workspace>
```

```bash
npm run dev        # starts both Express API (:3001) and Vite (:5173) concurrently
```

---

## Registered Agents

| Agent | Display Name | Skill(s) | Tool(s) | Threshold | Retries |
|---|---|---|---|---|---|
| `blueagent` | BlueAgent | — | — | 7/10 | 2 |
| `comedian` | Laughbot | humor | — | 7/10 | 3 |
| `mermaid` | Mermaid Diagrammer | mermaid_diagramming | — | 7/10 | 2 |
| `web_researcher` | Web Researcher | web_research | tavily_search | 6/10 | 2 |
| `kql` | KQL Query Builder | kql_generation | azure_sentinel | 7/10 | 2 |
| `threat_analyst` | Threat Analyst | threat_analysis | virustotal, abuseipdb, alienvault_otx, nvd_lookup | 7/10 | 2 |
| `skill_analyzer` | Skill Security Analyzer | — | — | no eval loop | — |

`skill_analyzer` is invoked automatically by the Skills page when a user installs a skill from an external URL. It has no eval loop — it runs once and returns a risk score (1–100) plus a verdict.

---

## Extending the System

### Add an agent

Create `agents/<name>.yaml`:

```yaml
name: my_agent                  # identifier used in code
display_name: My Agent          # shown in UI
description: >                  # used by orchestrator to route — be specific
  What this agent does and when to use it.
skills:
  - my_skill                    # filename in skills/ without .md
tools:
  - my_tool                     # filename in tools/ without extension
model:
  temperature: 0.7

mission: |
  Clearly state what this agent must accomplish and how.

expected: |
  Describe the exact format and content of the deliverable.

evaluator:
  criteria: |
    Score 1–10 across named criteria:
    - **Criterion A (1–N pts)**: description with low-end and high-end anchors.
    - **Criterion B (1–N pts)**: description with low-end and high-end anchors.
    Fail (score ≤N) if: explicit hard-fail conditions.
  threshold: 7       # minimum score to accept (1–10)
  max_retries: 3     # maximum attempts before returning best result
```

Restart the server — the agent is immediately available to the orchestrator.

### Add a skill

Create `skills/<name>.md`:

```markdown
# Skill: My Skill

Behavioral guidelines injected into the agent's system prompt...
```

Reference it in an agent's `skills:` list.

### Add a JavaScript tool

Create `tools/<name>.js`:

```javascript
export const schema = {
  name: 'my_tool',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The input' },
    },
    required: ['input'],
  },
}

export async function invoke({ input }) {
  // implementation
  return { result: '...' }
}
```

### Add a Python tool

Create `tools/<name>.py`:

```python
#!/usr/bin/env python3
"""
Tool: my_tool
Description: What this tool does
Input  (stdin JSON):  { "param": "value" }
Output (stdout JSON): { "result": "value" }
"""
import json, sys, os

def main():
    args = json.load(sys.stdin)
    # implementation
    print(json.dumps({ 'result': '...' }))

if __name__ == '__main__':
    main()
```

**Contract:** read args from `stdin` as JSON, write result to `stdout` as JSON, exit `0` on success, non-zero on error.

---

## Orchestration Workflows

The orchestrator selects one of two workflow types:

| Workflow | Description |
|---|---|
| `single` | One agent handles the request |
| `sequential` | Agents are chained — each receives the previous agent's output as context |

---

## Memory System

When an agent fails evaluation but eventually passes (after ≥ 1 retry), or exhausts all retries, a lesson file is written to `memory/`:

```
memory/
  comedian_2026-05-18T22-00-00-000Z.md
  writer_2026-05-18T22-05-00-000Z.md
```

Each file contains: the query, attempt history with scores, feedback, and sub-criteria critique, what worked, and a key lesson.

On every subsequent call the agent reads the **5 most recent** lesson files into its system prompt. After each write, files beyond the **10 most recent** per agent are pruned automatically to prevent prompt bloat.

---

## API

### `POST /api/chat`

**Request:**
```json
{
  "messages": [
    { "role": "user", "text": "Your message" },
    { "role": "ai",   "text": "Previous AI reply" }
  ]
}
```

**Response:**
```json
{
  "reply":      "Agent response text",
  "agent":      "comedian",
  "agentLabel": "Laughbot",
  "agents":     ["web_researcher", "writer", "evaluator"],
  "iterations": 2
}
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, react-markdown |
| API server | Express 5, Node.js |
| LLM | Azure OpenAI (via `@langchain/openai`) |
| Agent framework | LangChain (`@langchain/core`) |
| Web search | Tavily REST API |
| Config format | YAML (`js-yaml`) |
