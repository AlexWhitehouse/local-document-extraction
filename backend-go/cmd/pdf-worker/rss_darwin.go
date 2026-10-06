package main

import (
	"os"
	"unsafe"

	"github.com/ebitengine/purego"
)

var processUsage func(pid int32, flavor int32, info unsafe.Pointer) int32

func init() {
	library, err := purego.Dlopen("/usr/lib/libSystem.B.dylib", purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err == nil {
		purego.RegisterLibFunc(&processUsage, library, "proc_pid_rusage")
	}
}

// currentRSS reads ri_resident_size from rusage_info_v0: a 16-byte UUID, then
// six counters precede it. getrusage's peak may include the parent's usage.
func currentRSS() uint64 {
	if processUsage == nil {
		return 0
	}
	var info [12]uint64
	if processUsage(int32(os.Getpid()), 0, unsafe.Pointer(&info[0])) != 0 {
		return 0
	}
	return info[8]
}
