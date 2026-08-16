# Add resource control and throughput telemetry

Category: enhancement
Status: completed
Labels: completed

## Parent

../PRD.md

## What to build

Add portable process/resource sampling and stage metrics, then compare fixed limits with the researched slow adaptive controller. Adjust permits rather than recreating workers, stop admission/dispatch at memory/disk watermarks, and keep an explicit fixed mode if adaptation oscillates or reduces throughput.

## Acceptance criteria

- Completed jobs/s, queue age/depth, stage latency, permits, gateway outcomes, retry timing, CPU, RSS, external memory, event-loop responsiveness, SQLite busy/checkpoint state, and disk reserve are observable.
- Defaults target 85% CPU and 80% memory with lower soft/resume watermarks.
- Gateway concurrency increases slowly and decreases on throttling/timeout; PDF capacity responds to CPU/event-loop pressure.
- Fixed and adaptive modes are benchmarkable and every limit change records its reason.
- Resource sampling is verified on target macOS and documented for Bun-supported Linux.

## Blocked by

- Add efficient conditional individual job polling.
- Build the durable bounded Extraction work pump.
- Use bounded PDF file-ID transfer to the Model gateway.

## Resolution

Implemented fixed/adaptive permit modes, hard memory/event-loop pauses, slow headroom increases, gateway throttle/timeout decreases, and aggregate health telemetry for throughput, queue, permits, gateway outcomes, CPU, RSS/external memory, event-loop lag, disk reserve, and local storage bytes. Defaults use the agreed 85% CPU and 80% memory ceilings.
