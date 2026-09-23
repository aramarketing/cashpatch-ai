# Full Scan local AI integration

CashPatch Full Scan may enrich deterministic findings with a local-only AI runtime after the user completes Quick Scan and explicitly confirms Full Scan.

Runtime order: Ollama, LM Studio, configured Jev, configured custom-local endpoint. Every endpoint is subject to the native loopback-only egress policy; there is no cloud-AI fallback.

The semantic pass is advisory and review-only. Sensitive credential-named files are excluded from model review. Findings contain bounded evidence and human remediation guidance only. Deterministic collection continues even when no local AI is available or the local model fails.

A per-scan semantic document ceiling protects system resources on very large estates. This file also intentionally triggers native macOS/Windows desktop CI and installer E2E after the integration commit.
