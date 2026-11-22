---
"@folijs/mcp": patch
---

Code mode: a run's 10 seconds count from when its sandbox is ready, not from when its thread is started. On a busy machine starting the thread and QuickJS alone took seconds, and a short script could fail with "It did not finish in 10 seconds" without having run. The start has a limit of its own, 30 seconds ("The sandbox did not start in 30 seconds.").
