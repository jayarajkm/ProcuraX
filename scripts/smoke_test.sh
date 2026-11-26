#!/usr/bin/env bash
# Demo smoke test against a running stack.   Usage: scripts/smoke_test.sh [base_url] [password]
# Exercises login, database-backed endpoints and the deterministic bots (no LLM key needed).
set -uo pipefail
BASE="${1:-http://127.0.0.1:8000}"; PW="${2:-Demo@12345}"; fail=0
ok(){ printf "  PASS  %s\n" "$1"; }; bad(){ printf "  FAIL  %s\n" "$1"; fail=1; }
check(){ local name="$1" cond="$2"; if eval "$cond"; then ok "$name"; else bad "$name"; fi; }
login(){ curl -s -m 10 -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PW\"}"; }
tok(){ python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'; }
get(){ curl -s -m 20 -H "Authorization: Bearer $T" "$BASE/api/v1$1"; }
post(){ curl -s -m 60 -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d "$2" "$BASE/api/v1$1"; }
jq_(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
echo "Smoke test: $BASE"
check "health + pgvector" "curl -s -m 10 $BASE/health | grep -q '\"pgvector\":true'"
T=$(login manager@procurax.demo | tok); check "manager login" "[ -n \"$T\" ]"
check "bad password rejected" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/v1/auth/login -H 'content-type: application/json' -d '{\"email\":\"manager@procurax.demo\",\"password\":\"nope\"}')\" = 401 ]"
check "dashboard from database" "[ \"\$(get /dashboard/overview | jq_ 'd[\"total_products\"]')\" = 200 ]"
check "30 suppliers (at least 30)" "[ \"\$(get '/suppliers?page_size=1' | jq_ 'd[\"total\"]>=30')\" = True ]"
check "inventory 1000 rows (at least 1000)" "[ \"\$(get '/inventory?page_size=1' | jq_ 'd[\"total\"]>=1000')\" = True ]"
check "150 purchase orders (at least 150)" "[ \"\$(get '/purchase-orders?page_size=1' | jq_ 'd[\"total\"]>=150')\" = True ]"
check "reorder recommendations" "[ \"\$(get /inventory/reorder-recommendations | jq_ 'isinstance(d,list) and len(d)>0')\" = True ]"
check "rule bot (threshold)" "post /chatbots/rule_based/chat '{\"message\":\"What is the purchase approval threshold?\"}' | grep -q 'require Procurement Manager'"
check "nlp bot (pending POs)" "post /chatbots/nlp/chat '{\"message\":\"Which POs are still pending?\"}' | grep -q 'awaiting approval'"
check "ml bot (classify)" "post /chatbots/ml/chat '{\"message\":\"classify: shipment arrived 10 days late\"}' | grep -qi 'delivery issue'"
check "ml models trained" "[ \"\$(get /ml/models | jq_ 'len([m for m in d if m[\"is_active\"]])')\" = 3 ]"
check "documents indexed" "[ \"\$(get '/documents?status=indexed&page_size=1' | jq_ 'd[\"total\"]>0')\" = True ]"
check "semantic search" "get '/documents/search?q=approval%20threshold&min_similarity=0.2' | grep -q 'Purchase Approval Policy'"
check "viewer cannot write" "[ \"\$(T=\$(login viewer@procurax.demo | tok); curl -s -o /dev/null -w '%{http_code}' -X POST -H \"Authorization: Bearer \$T\" -H 'content-type: application/json' -d '{}' $BASE/api/v1/products)\" = 403 ]"
echo "(LLM bots, agent: run manually; need a configured provider key.)"
[ $fail = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
