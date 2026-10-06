# Bun and Go document processing comparison

Host: 6 CPUs (Intel Core Processor (Haswell, no TSX)), 11.4 GiB RAM; linux x64.
Bun 1.4.2; Go rendering workers: 6. Generated: 2026-10-05T19:30:12.738Z.
Each scenario: 60 s load, 10 s warm-up excluded, 24 processing permits, 24 submitters, backlog 24.
Simulated model delay: 0 ms. Both processors use identical fixture bytes and extraction settings. Runs execute sequentially.

| PDF mode / scenario | Bun Documents/s | Go Documents/s | Speedup | p95 ms, Bun → Go | Peak tree MiB, Bun → Go |
| --- | ---: | ---: | ---: | ---: | ---: |
| inline-pdf / explicit | 45.42 | 66.13 | 1.46× | 172 → 519 | 798 → 770 |
| inline-pdf / automatic | 31.31 | 45.45 | 1.45× | 285 → 792 | 803 → 791 |
| inline-pdf / split-explicit | 38.86 | 45.74 | 1.18× | 1,731 → 1,759 | 949 → 1005 |
| inline-pdf / split-automatic | 23.05 | 35.24 | 1.53× | 6,543 → 2,229 | 944 → 1045 |
| rendered-pages / explicit | 4.40 | 8.30 | 1.89× | 8,964 → 5,262 | 723 → 1603 |
| rendered-pages / automatic | 2.08 | 7.88 | 3.79× | 20,966 → 5,416 | 700 → 1610 |
| rendered-pages / split-explicit | 4.00 | 7.12 | 1.78× | 22,041 → 12,723 | 802 → 1781 |
| rendered-pages / split-automatic | 2.64 | 7.18 | 2.72× | 32,626 → 12,162 | 799 → 1793 |

| PDF mode / scenario | Expected admission 503s, Bun → Go | Go accepted uploads/s | Go admission p50 / p95 ms |
| --- | ---: | ---: | ---: |
| inline-pdf / explicit | 120 → 123 | 66.16 | 260 / 394 |
| inline-pdf / automatic | 156 → 196 | 45.38 | 273 / 421 |
| inline-pdf / split-explicit | 236 → 147 | 22.68 | 312 / 475 |
| inline-pdf / split-automatic | 152 → 146 | 17.74 | 333 / 491 |
| rendered-pages / explicit | 122 → 216 | 8.38 | 114 / 237 |
| rendered-pages / automatic | 56 → 179 | 8.16 | 121 / 225 |
| rendered-pages / split-explicit | 56 → 88 | 3.78 | 131 / 917 |
| rendered-pages / split-automatic | 40 → 96 | 3.68 | 489 / 989 |

Admission latency covers successful uploads only, under the same backlog-limited workload. It is not an isolated admission-capacity measurement. The original saturation pass predates admission-latency instrumentation; matched provider/response passes include both engines.


All accepted Documents completed, with zero failed/missing Documents, invalid model requests, network errors or drain errors. Model-stage counts matched each workload.

Documents/s counts persisted extractions completed inside the measurement window. A split upload creates two Documents. p95 covers complete upload lifecycles, including both children; latency includes drained work. RSS includes Bun, Go and PDF subprocesses and can double-count shared pages. These are host-specific observations with a simulated gateway, not estimates of paid-model capacity or extraction accuracy.

Settings:
```json
{
  "cpuProfile": false,
  "memoryLimitRatio": 0.25,
  "preparationMaxBytes": 536870912,
  "scenarios": [
    "explicit",
    "automatic",
    "split-explicit",
    "split-automatic"
  ],
  "backlog": 24,
  "drainTimeoutSeconds": 180,
  "durationSeconds": 60,
  "gatewayLatencyMs": 0,
  "inlinePayloadBytes": 1048576,
  "modes": [
    "inline-pdf",
    "rendered-pages"
  ],
  "renderPages": 2,
  "runnerConcurrency": 24,
  "submitters": 24,
  "warmupSeconds": 10,
  "responseAnswerBytes": 0
}
```

Bun evidence: `backend-go/benchmarks/results/bun-saturation.json`

Go evidence: `backend-go/benchmarks/results/go-saturation.json`
