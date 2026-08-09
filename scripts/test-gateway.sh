#!/bin/bash
# FreeLLM Gateway Test Script
# Usage: ./scripts/test-gateway.sh [base_url]

BASE_URL="${1:-http://localhost:5180}"
PASS=0
FAIL=0
TOTAL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }
bold() { printf "\033[1m%s\033[0m\n" "$1"; }
dim() { printf "\033[2m%s\033[0m\n" "$1"; }

check() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local expected="$2"
  local actual="$3"

  if echo "$actual" | grep -q "$expected"; then
    PASS=$((PASS + 1))
    green "  PASS  $name"
  else
    FAIL=$((FAIL + 1))
    red "  FAIL  $name"
    dim "        expected: $expected"
    dim "        got: $(echo "$actual" | head -1 | cut -c1-120)"
  fi
}

# ─────────────────────────────────────────
bold ""
bold "FreeLLM Gateway Tests"
bold "Target: $BASE_URL"
bold "─────────────────────────────────────"

# 1. Health check
bold ""
bold "[1/7] Health Check"
HEALTH=$(curl -s "$BASE_URL/healthz")
check "GET /healthz returns ok" '"status":"ok"' "$HEALTH"

# 2. List models
bold ""
bold "[2/7] List Models"
MODELS=$(curl -s "$BASE_URL/v1/models")
check "GET /v1/models returns list" '"object":"list"' "$MODELS"
check "Meta-models present (free)" '"id":"free"' "$MODELS"
check "Meta-models present (free-fast)" '"id":"free-fast"' "$MODELS"
check "Meta-models present (free-smart)" '"id":"free-smart"' "$MODELS"

MODEL_COUNT=$(echo "$MODELS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
dim "        Models available: $MODEL_COUNT"

# 3. Gateway status
bold ""
bold "[3/7] Gateway Status"
STATUS=$(curl -s "$BASE_URL/v1/status")
check "GET /v1/status returns routingStrategy" '"routingStrategy"' "$STATUS"
check "Status includes providers array" '"providers"' "$STATUS"

ENABLED=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for p in d['providers'] if p['enabled']))" 2>/dev/null)
dim "        Enabled providers: $ENABLED"

# 4. Non-streaming chat completion (free-fast)
bold ""
bold "[4/7] Chat Completion (non-streaming, free-fast)"
CHAT=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-fast",
    "messages": [{"role": "user", "content": "Say hello in exactly 3 words."}],
    "max_tokens": 20
  }')
HTTP_CODE=$(echo "$CHAT" | tail -1)
BODY=$(echo "$CHAT" | sed '$d')
check "POST /v1/chat/completions returns 200" "200" "$HTTP_CODE"
check "Response has choices" '"choices"' "$BODY"
check "Response has x_freellm_provider" '"x_freellm_provider"' "$BODY"

PROVIDER=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('x_freellm_provider','?'))" 2>/dev/null)
CONTENT=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'][:80])" 2>/dev/null)
dim "        Provider: $PROVIDER"
dim "        Response: $CONTENT"

# 5. Non-streaming chat completion (free-smart)
bold ""
bold "[5/7] Chat Completion (non-streaming, free-smart)"
CHAT2=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-smart",
    "messages": [{"role": "user", "content": "What is 2+2? Reply with just the number."}],
    "max_tokens": 10
  }')
HTTP_CODE2=$(echo "$CHAT2" | tail -1)
BODY2=$(echo "$CHAT2" | sed '$d')
check "free-smart returns 200" "200" "$HTTP_CODE2"

PROVIDER2=$(echo "$BODY2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('x_freellm_provider','?'))" 2>/dev/null)
CONTENT2=$(echo "$BODY2" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'][:80])" 2>/dev/null)
dim "        Provider: $PROVIDER2"
dim "        Response: $CONTENT2"

# 6. Streaming
bold ""
bold "[6/7] Chat Completion (streaming)"
STREAM=$(curl -s "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-fast",
    "messages": [{"role": "user", "content": "Say hi."}],
    "max_tokens": 10,
    "stream": true
  }')
check "Streaming response contains SSE data" "data:" "$STREAM"
check "Streaming response ends with [DONE]" "[DONE]" "$STREAM"

# 7. NVIDIA NIM (direct provider test)
bold ""
bold "[7/8] NVIDIA NIM Direct Test"
NIM=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nim/meta/llama-3.3-70b-instruct",
    "messages": [{"role": "user", "content": "Reply with just the word: hello"}],
    "max_tokens": 10
  }')
NIM_CODE=$(echo "$NIM" | tail -1)
NIM_BODY=$(echo "$NIM" | sed '$d')
check "NIM direct call returns 200" "200" "$NIM_CODE"
check "NIM response has choices" '"choices"' "$NIM_BODY"
check "NIM x_freellm_provider is nim" '"x_freellm_provider":"nim"' "$NIM_BODY"

NIM_CONTENT=$(echo "$NIM_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'][:80])" 2>/dev/null)
dim "        Model: nim/meta/llama-3.3-70b-instruct"
dim "        Response: $NIM_CONTENT"

# 8. Validation
bold ""
bold "[8/8] Request Validation"
BAD_REQ=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model": "", "messages": []}')
BAD_CODE=$(echo "$BAD_REQ" | tail -1)
check "Empty model returns 400" "400" "$BAD_CODE"

NO_BODY=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{}')
NO_BODY_CODE=$(echo "$NO_BODY" | tail -1)
check "Missing fields returns 400" "400" "$NO_BODY_CODE"

# ─────────────────────────────────────────
bold ""
bold "─────────────────────────────────────"
if [ $FAIL -eq 0 ]; then
  green "All $TOTAL tests passed"
else
  red "$FAIL/$TOTAL tests failed"
fi
bold ""
