#!/usr/bin/env python3
"""Compare successful, matched loopback benchmark runs; never compare ingress RPS."""
import argparse
import json


def load(path):
    with open(path, encoding="utf-8") as source:
        run = json.load(source)
    run["settings"].setdefault("responseAnswerBytes", 0)
    for row in run["results"]:
        timing = row["serverTiming"]
        assert timing["failed"] == timing["other"] == 0, "unfinished or failed Documents"
        assert not row["client"]["networkErrors"], "network errors"
        assert not row["client"]["unexpectedResponses"], "load/drain errors"
        assert row["gateway"]["invalidRequests"] == 0, "invalid model requests"
        assert timing["completed"] == row["accepted"] * row["jobsPerSubmission"], "missing Documents"
        automatic = row["scenario"].endswith("automatic")
        splitting = row["scenario"].startswith("split-")
        assert row["gateway"]["requestsByStage"] == {
            "extraction": timing["completed"],
            "classification": timing["completed"] if automatic else 0,
            "splitting": row["accepted"] if splitting else 0,
        }, "unexpected model stage counts"
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bun")
    parser.add_argument("go")
    args = parser.parse_args()
    bun, go = load(args.bun), load(args.go)
    assert bun["settings"] == go["settings"], "benchmark settings differ"
    assert bun["host"] == go["host"], "benchmark hosts differ"
    assert bun["runtime"]["processor"] == "bun" and go["runtime"]["processor"] == "go"
    reference = {(r["mode"], r["scenario"]): r for r in bun["results"]}
    assert set(reference) == {(r["mode"], r["scenario"]) for r in go["results"]}
    print("# Bun and Go document processing comparison\n")
    host, settings = bun["host"], bun["settings"]
    print(f"Host: {host['cpuCount']} CPUs ({host['cpuModel']}), {host['memoryBytes'] / 2**30:.1f} GiB RAM; {host['platform']} {host['architecture']}.")
    print(f"Bun {bun['runtime']['version']}; Go rendering workers: {go['runtime']['pdfWorkers'] or 6}. Generated: {go['generatedAt']}.")
    print(f"Each scenario: {settings['durationSeconds']} s load, {settings['warmupSeconds']} s warm-up excluded, {settings['runnerConcurrency']} processing permits, {settings['submitters']} submitters, backlog {settings['backlog']}.")
    print(f"Simulated model delay: {settings['gatewayLatencyMs']} ms. Both processors use identical fixture bytes and extraction settings. Runs execute sequentially.\n")
    print("| PDF mode / scenario | Bun Documents/s | Go Documents/s | Speedup | p95 ms, Bun → Go | Peak tree MiB, Bun → Go |")
    print("| --- | ---: | ---: | ---: | ---: | ---: |")
    for candidate in go["results"]:
        old = reference[candidate["mode"], candidate["scenario"]]
        assert old["fixture"] == candidate["fixture"], "fixture bytes differ"
        before, after = old["serverTiming"], candidate["serverTiming"]
        rate_before, rate_after = before["measurementJobsPerSecond"], after["measurementJobsPerSecond"]
        assert rate_before > 0 and rate_after > 0, "insufficient measurement window"
        latency_before = before["submissions"]["lifecycleP95Ms"]
        latency_after = after["submissions"]["lifecycleP95Ms"]
        rss_before = old["app"]["peakProcessTreeRssBytes"] / 2**20
        rss_after = candidate["app"]["peakProcessTreeRssBytes"] / 2**20
        print(f"| {candidate['mode']} / {candidate['scenario']} | {rate_before:.2f} | {rate_after:.2f} | {rate_after / rate_before:.2f}× | {latency_before:,.0f} → {latency_after:,.0f} | {rss_before:.0f} → {rss_after:.0f} |")
    print("\n| PDF mode / scenario | Expected admission 503s, Bun → Go | Go accepted uploads/s | Go admission p50 / p95 ms |")
    print("| --- | ---: | ---: | ---: |")
    for candidate in go["results"]:
        old = reference[candidate["mode"], candidate["scenario"]]
        admission = candidate.get("admission", {})
        print(f"| {candidate['mode']} / {candidate['scenario']} | {old['client']['rejected']} → {candidate['client']['rejected']} | {admission.get('acceptedUploadsPerSecond', 0):.2f} | {admission.get('responseP50Ms', 0):.0f} / {admission.get('responseP95Ms', 0):.0f} |")
    print("\nAdmission latency covers successful uploads only, under the same backlog-limited workload. It is not an isolated admission-capacity measurement. The original saturation pass predates admission-latency instrumentation; matched provider/response passes include both engines.\n")
    print("\nAll accepted Documents completed, with zero failed/missing Documents, invalid model requests, network errors or drain errors. Model-stage counts matched each workload.")
    print("\nDocuments/s counts persisted extractions completed inside the measurement window. A split upload creates two Documents. p95 covers complete upload lifecycles, including both children; latency includes drained work. RSS includes Bun, Go and PDF subprocesses and can double-count shared pages. These are host-specific observations with a simulated gateway, not estimates of paid-model capacity or extraction accuracy.")
    print("\nSettings:\n```json\n" + json.dumps(settings, indent=2) + "\n```")
    print(f"\nBun evidence: `{args.bun}`\n\nGo evidence: `{args.go}`")


if __name__ == "__main__":
    main()
