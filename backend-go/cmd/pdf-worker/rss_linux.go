package main

import (
	"bytes"
	"os"
	"strconv"
)

// currentRSS reads resident pages from /proc. getrusage's peak is unusable:
// Linux preserves it across execve, so a worker would inherit its parent's peak.
func currentRSS() uint64 {
	data, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return 0
	}
	fields := bytes.Fields(data)
	if len(fields) < 2 {
		return 0
	}
	pages, err := strconv.ParseUint(string(fields[1]), 10, 64)
	if err != nil {
		return 0
	}
	return pages * uint64(os.Getpagesize())
}
