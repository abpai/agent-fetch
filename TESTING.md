# Testing Guide

Step-by-step manual and automated testing for every piece of agent-fetch functionality, including Codex app-server JSON-RPC integration.

---

## Step 0: Install & link the binary

```bash
cd ~/Projects/crawl
bun install
bun link
bun link @andypai/agent-fetch
```

Verify:

```bash
agent-fetch --help
# Should print usage: agent-fetch fetch, setup, plugins subcommands
```

---

## Step 1: Automated tests

```bash
bun run check   # lint + typecheck
bun run test    # 12 tests across 3 files (src/)
```

---

## Step 2: CLI help & error handling

```bash
# Help output
agent-fetch
agent-fetch -h
agent-fetch fetch --help
agent-fetch setup --help
agent-fetch plugins --help

# Argument errors (exit code 2)
agent-fetch fetch                                  # missing URL
agent-fetch fetch https://x --strategy bogus       # invalid strategy
agent-fetch fetch https://x --timeout abc          # non-numeric timeout
agent-fetch fetch https://x --with-credentials --no-agent-browser  # incompatible flags
agent-fetch fetch https://x --strategy authenticated --no-agent-browser  # incompatible flags
```

Verify each error prints to stderr and exits with code 2.

---

## Step 3: Fetch — static page (`fetch` strategy)

```bash
# Markdown output (stdout only)
agent-fetch fetch https://example.com

# JSON output — verify all fields present
agent-fetch fetch https://example.com --json
# Expected: strategy="fetch", title="Example Domain", wordCount > 0, attempts[0].ok=true

# Debug attempts — attempt info goes to stderr
agent-fetch fetch https://example.com --debug-attempts 2>/tmp/attempts.txt
cat /tmp/attempts.txt
# Should show: "fetch: ok (Nms)"

# Simple mode — fetch only, no fallback
agent-fetch fetch https://example.com --strategy simple
```

---

## Step 4: Fetch — fallback chain (`auto` mode)

```bash
# Force fetch to fail thresholds, jsdom should pick it up
AGENT_FETCH_MIN_WORD_COUNT=999999 agent-fetch fetch https://example.com --no-plugins --no-agent-browser --json --debug-attempts 2>/tmp/attempts.txt
# Should fail: "All fetch strategies failed"
cat /tmp/attempts.txt
# Should show fetch rejected, jsdom rejected

# Force everything to fail
AGENT_FETCH_MIN_WORD_COUNT=999999 agent-fetch fetch https://example.com --json --no-agent-browser --debug-attempts 2>&1 | head -5
# Exit code 1, "All fetch strategies failed"
```

---

## Step 5: Plugins — list & scrape-do execution

```bash
# List plugins (text)
agent-fetch plugins list
# Output: scrape-do, required: token, optional: endpoint, params, headers, timeout

# List plugins (JSON)
agent-fetch plugins list --json

# Test scrape-do plugin execution with your token
cat > /tmp/scrape-do-config.json << 'EOF'
{
  "plugins": [
    { "type": "scrape-do", "token": "YOUR_SCRAPEDO_TOKEN" }
  ]
}
EOF

# Fetch with plugin configured (auto mode will try fetch first, then jsdom, then scrape-do)
agent-fetch fetch https://example.com --config /tmp/scrape-do-config.json --json --debug-attempts

# Force scrape-do to be the only plugin that succeeds by raising thresholds
AGENT_FETCH_MIN_WORD_COUNT=999999 agent-fetch fetch https://example.com \
  --config /tmp/scrape-do-config.json --no-agent-browser --json --debug-attempts 2>/tmp/attempts.txt
cat /tmp/attempts.txt
# fetch: rejected, jsdom: rejected, scrape-do: rejected (if example.com is below 999999 words)

# Test with env var interpolation for token
cat > /tmp/scrape-do-env-config.json << 'EOF'
{
  "plugins": [
    { "type": "scrape-do", "token": "${SCRAPEDO_TOKEN}" }
  ]
}
EOF

SCRAPEDO_TOKEN=your_actual_token agent-fetch fetch https://example.com \
  --config /tmp/scrape-do-env-config.json --json --debug-attempts

# Test with render param (scrape-do renders JS)
cat > /tmp/scrape-do-render.json << 'EOF'
{
  "plugins": [
    {
      "type": "scrape-do",
      "token": "${SCRAPEDO_TOKEN}",
      "params": { "render": true }
    }
  ]
}
EOF

SCRAPEDO_TOKEN=your_actual_token agent-fetch fetch https://news.ycombinator.com \
  --config /tmp/scrape-do-render.json --json --debug-attempts
```

---

## Step 6: Setup command

```bash
# Interactive setup (requires TTY)
agent-fetch setup
# Enter: 9222 for CDP port, optional launch command
# Creates ~/.config/agent-fetch/config.json and ~/.config/agent-fetch/.env

# Verify
cat ~/.config/agent-fetch/config.json
cat ~/.config/agent-fetch/.env

# Non-interactive setup
AGENT_FETCH_CDP_PORT=9222 agent-fetch setup --no-input --overwrite

# Non-interactive without required env (should fail)
agent-fetch setup --no-input
# Error: "Missing environment value: AGENT_FETCH_CDP_PORT"

# With launch command
AGENT_FETCH_CDP_PORT=9222 \
AGENT_FETCH_CDP_LAUNCH='open -na "Google Chrome" --args --remote-debugging-port=9222' \
  agent-fetch setup --no-input --overwrite
cat ~/.config/agent-fetch/.env
# Should contain both AGENT_FETCH_CDP_PORT and AGENT_FETCH_CDP_LAUNCH
```

---

## Step 7: Authenticated mode (agent-browser)

```bash
# Launch Chrome with CDP
open -na "Google Chrome" --args --remote-debugging-port=9222

# Set the port
export AGENT_FETCH_CDP_PORT=9222

# Authenticated fetch
agent-fetch fetch https://example.com --with-credentials --json --debug-attempts
# strategy="agent-browser", single attempt, ok=true

# Equivalent via --strategy flag
agent-fetch fetch https://example.com --strategy authenticated --json

# Fail-fast test (wrong port)
AGENT_FETCH_CDP_PORT=9999 agent-fetch fetch https://example.com --with-credentials --json
# Immediate failure: "Authenticated fetch failed via agent-browser"

# Verify exit code
agent-fetch fetch https://example.com --with-credentials; echo "exit: $?"  # 0
AGENT_FETCH_CDP_PORT=9999 agent-fetch fetch https://example.com --with-credentials; echo "exit: $?"  # 1
```

---

## Step 8: Config precedence

```bash
# Config file
cat > /tmp/test-config.json << 'EOF'
{ "timeout": 5000, "enableJsdom": false, "minWordCount": 5 }
EOF
agent-fetch fetch https://example.com --config /tmp/test-config.json --json --debug-attempts

# Env var overrides config file
AGENT_FETCH_TIMEOUT=2000 agent-fetch fetch https://example.com --config /tmp/test-config.json --json

# CLI flags override env vars
AGENT_FETCH_ENABLE_JSDOM=true agent-fetch fetch https://example.com --no-jsdom --json --debug-attempts 2>/tmp/a.txt
cat /tmp/a.txt
# jsdom should NOT appear (CLI --no-jsdom wins)
```

---

## Step 9: Library API

```bash
bun -e "
import { fetchUrl } from '@andypai/agent-fetch'
const r = await fetchUrl('https://example.com', { strategyMode: 'simple' })
console.log('strategy:', r.strategy)
console.log('title:', r.title)
console.log('words:', r.wordCount)
console.log('attempts:', JSON.stringify(r.attempts))
"
```

---

## Step 10: stdout/stderr guardrails

```bash
# Clean separation
agent-fetch fetch https://example.com > /tmp/stdout.txt 2> /tmp/stderr.txt
wc -l /tmp/stdout.txt  # has content
wc -l /tmp/stderr.txt  # empty (no errors)

# Debug goes to stderr only
agent-fetch fetch https://example.com --debug-attempts > /tmp/stdout.txt 2> /tmp/stderr.txt
cat /tmp/stderr.txt  # "fetch: ok (Nms)"

# Exit codes
agent-fetch fetch https://example.com; echo "exit: $?"          # 0
agent-fetch fetch; echo "exit: $?"                               # 2
AGENT_FETCH_MIN_WORD_COUNT=999999 agent-fetch fetch https://example.com --strategy simple; echo "exit: $?"  # 1
```

---

## Step 11: Codex app-server JSON-RPC integration

This is the primary integration target. Codex app-server uses JSON-RPC 2.0 over stdio (newline-delimited JSON).

### 11a. Start the app-server

```bash
# Terminal 1: start the app-server
codex app-server
```

The server reads JSON-RPC from stdin and writes responses/notifications to stdout.

### 11b. Initialize the connection

Send (paste into stdin, press Enter):

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"manual-test","title":"Manual Test","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
```

You'll get back a response with `"id":1` and a result object. Then send the `initialized` notification:

```json
{"method":"initialized"}
```

### 11c. Start a thread

```json
{"method":"thread/start","id":2,"params":{"cwd":"/Users/andypai/Projects/crawl","approvalPolicy":"never","sandbox":"danger-full-access"}}
```

You'll receive a `thread/started` notification and a response with `thread.id`. Note the `threadId` value (e.g., `"thr_abc123"`).

### 11d. Ask Codex to run agent-fetch

Send a turn with the thread ID from step 11c:

```json
{"method":"turn/start","id":3,"params":{"threadId":"THREAD_ID_HERE","input":[{"type":"text","text":"Run `agent-fetch fetch https://example.com --json` and show me the title and word count from the output."}]}}
```

You'll see streaming notifications:
- `item/started` — agent begins reasoning
- `item/agentMessage/delta` — text chunks from the agent
- `item/started` with `type: "commandExecution"` — agent runs the command
- `item/completed` — command finishes with stdout/stderr/exitCode
- `turn/completed` — turn is done

### 11e. Test more commands via turns

Test SKILL.md discovery — ask about available strategies:

```json
{"method":"turn/start","id":4,"params":{"threadId":"THREAD_ID_HERE","input":[{"type":"text","text":"Read SKILL.md and then run `agent-fetch fetch https://news.ycombinator.com --strategy simple --json --debug-attempts`. Show the strategy used and any attempt details."}]}}
```

Test authenticated mode:

```json
{"method":"turn/start","id":5,"params":{"threadId":"THREAD_ID_HERE","input":[{"type":"text","text":"Run `agent-fetch fetch https://example.com --with-credentials --json` and report whether it succeeded or failed."}]}}
```

Test plugin listing:

```json
{"method":"turn/start","id":6,"params":{"threadId":"THREAD_ID_HERE","input":[{"type":"text","text":"Run `agent-fetch plugins list --json` and summarize the available plugins."}]}}
```

### 11f. Direct command execution (no thread)

You can also run commands directly without a thread context:

```json
{"method":"command/exec","id":7,"params":{"command":["agent-fetch","fetch","https://example.com","--json"],"cwd":"/Users/andypai/Projects/crawl"}}
```

This returns stdout, stderr, and exitCode directly.

### 11g. Scripted test (pipe messages)

For a complete automated test, create a script:

```bash
cat > /tmp/test-app-server.sh << 'SCRIPT'
#!/bin/bash
# Pipe JSON-RPC messages to codex app-server and capture output

(
  # Initialize
  echo '{"method":"initialize","id":1,"params":{"clientInfo":{"name":"test","version":"0.1.0"},"capabilities":{}}}'
  sleep 1
  echo '{"method":"initialized"}'
  sleep 0.5

  # Direct command exec (no thread needed)
  echo '{"method":"command/exec","id":2,"params":{"command":["agent-fetch","fetch","https://example.com","--json"],"cwd":"/Users/andypai/Projects/crawl"}}'
  sleep 10

  # Second command
  echo '{"method":"command/exec","id":3,"params":{"command":["agent-fetch","plugins","list","--json"],"cwd":"/Users/andypai/Projects/crawl"}}'
  sleep 5
) | codex app-server 2>/dev/null | while IFS= read -r line; do
  echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"
done
SCRIPT

chmod +x /tmp/test-app-server.sh
/tmp/test-app-server.sh
```

### 11h. WebSocket transport (alternative)

```bash
# Start with WebSocket
codex app-server --listen ws://127.0.0.1:4500

# In another terminal, use websocat or similar
websocat ws://127.0.0.1:4500
# Then paste the same JSON-RPC messages
```

---

## Verification checklist

- [ ] `bun run check` passes
- [ ] `bun run test` passes (10 tests)
- [ ] `agent-fetch --help` prints help
- [ ] `agent-fetch fetch <url>` returns markdown to stdout
- [ ] `agent-fetch fetch <url> --json` returns valid JSON
- [ ] `agent-fetch fetch <url> --strategy simple` uses fetch only
- [ ] `agent-fetch fetch <url> --debug-attempts` prints to stderr
- [ ] `agent-fetch plugins list` shows scrape-do
- [ ] `agent-fetch plugins list --json` returns valid JSON
- [ ] scrape-do plugin works with real token
- [ ] `${ENV_VAR}` interpolation works in plugin config
- [ ] `agent-fetch setup` runs interactive flow
- [ ] `agent-fetch setup --no-input` works with env vars
- [ ] `--with-credentials` uses agent-browser only
- [ ] Authenticated fail-fast works (wrong port)
- [ ] Config precedence: CLI > env > config file
- [ ] Exit codes: 0 (success), 1 (fetch failure), 2 (arg error)
- [ ] Library import works via `bun -e`
- [ ] Codex app-server `initialize` + `initialized` handshake works
- [ ] Codex app-server `command/exec` runs agent-fetch and returns output
- [ ] Codex app-server `thread/start` + `turn/start` drives agent-fetch via SKILL.md
