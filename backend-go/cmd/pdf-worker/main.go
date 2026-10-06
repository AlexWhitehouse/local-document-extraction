// Command document-extraction-pdf is an isolated PDFium rendering process for
// the Go processor. A crash, deadline or memory breach loses one process.
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"document-extraction.local/backend/internal/pdfium"
)

const (
	sourceLimit        = 32 << 20
	artifactLimit      = 32 << 20
	totalArtifactLimit = 64 << 20
	metadataLimit      = 128 << 10
	pageLimit          = 10_000
	// Requests with more than 20 images reject edges above 2000 px at some
	// providers. 2× (144 DPI) is kept for ordinary page sizes.
	renderScale   = 2
	maxRenderEdge = 2000
	recycleRSS    = 384 << 20
	hardRSS       = 1 << 30
)

var errSelection = errors.New("invalid page selection")

func main() {
	if len(os.Args) != 2 || os.Args[1] != "render" {
		os.Stderr.WriteString("usage: document-extraction-pdf render\n")
		os.Exit(2)
	}
	library, err := pdfium.Open(libraryPath())
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	go watchMemory()
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriterSize(os.Stdout, 256<<10)
	serveRender(library, in, out)
}

func libraryPath() string {
	if path := os.Getenv("PDFIUM_LIBRARY"); path != "" {
		return path
	}
	name := "libpdfium.so"
	if runtime.GOOS == "darwin" {
		name = "libpdfium.dylib"
	}
	executable, err := os.Executable()
	if err != nil {
		return name
	}
	return filepath.Join(filepath.Dir(executable), name)
}

// A hostile document can exhaust memory inside one operation; recycling after
// the operation is too late for that case.
func watchMemory() {
	for range time.Tick(25 * time.Millisecond) {
		if peakRSS() > hardRSS {
			os.Exit(3)
		}
	}
}

func peakRSS() uint64 {
	var usage syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) != nil {
		return 0
	}
	if runtime.GOOS == "darwin" {
		return uint64(usage.Maxrss)
	}
	return uint64(usage.Maxrss) << 10
}

type renderRequest struct {
	Operation   string `json:"operation"`
	SourcePath  string `json:"source_path"`
	Pages       []int  `json:"pages"`
	Compression string `json:"compression"`
}

func serveRender(library *pdfium.Library, in *bufio.Reader, out *bufio.Writer) {
	maxOperations := 128
	if value, err := strconv.Atoi(os.Getenv("GO_PDF_WORKER_DOCUMENTS")); err == nil && value > 0 {
		maxOperations = value
	}
	header := make([]byte, 4)
	for operations := 1; ; operations++ {
		if _, err := io.ReadFull(in, header); err != nil {
			return
		}
		size := binary.BigEndian.Uint32(header)
		if size == 0 || size > metadataLimit {
			return
		}
		metadata := make([]byte, size)
		if _, err := io.ReadFull(in, metadata); err != nil {
			return
		}
		// The processor passes a path, never inline bytes, so the source frame is empty.
		if _, err := io.ReadFull(in, header); err != nil || binary.BigEndian.Uint32(header) != 0 {
			return
		}
		var request renderRequest
		if err := json.Unmarshal(metadata, &request); err != nil || request.Operation != "render" {
			fail(out, 21)
			return
		}
		if err := render(library, request, out); err != nil {
			code := int32(21)
			if errors.Is(err, pdfium.ErrLimit) {
				code = 22
			} else if errors.Is(err, errSelection) {
				code = 24
			}
			fail(out, code)
			return
		}
		retire := operations >= maxOperations || peakRSS() >= recycleRSS
		flag := byte(0)
		if retire {
			flag = 1
		}
		_, _ = out.Write([]byte{0, 0, 0, 0, flag})
		if out.Flush() != nil || retire {
			return
		}
	}
}

func fail(out *bufio.Writer, code int32) {
	var frame [4]byte
	binary.BigEndian.PutUint32(frame[:], uint32(-code))
	_, _ = out.Write(frame[:])
	_ = out.Flush()
}

type encodedPage struct {
	png     []byte
	elapsed time.Duration
}

// Each page's encoding overlaps the next page's rasterization; at most one
// encoded page is outstanding, and artifacts are emitted in page order.
func render(library *pdfium.Library, request renderRequest, out *bufio.Writer) error {
	started := time.Now()
	document, err := library.OpenFile(request.SourcePath, sourceLimit)
	if err != nil {
		return err
	}
	defer document.Close()
	count := document.PageCount()
	pages := request.Pages
	if pages == nil {
		if count < 1 || count > pageLimit {
			return errSelection
		}
		pages = make([]int, count)
		for i := range pages {
			pages[i] = i + 1
		}
	}
	if err := validatePages(pages, count); err != nil {
		return err
	}
	timings := struct {
		Load, Raster, Encode float64
		Pages, RSS           uint64
	}{Load: milliseconds(time.Since(started))}
	best := request.Compression == "best"
	written := 0
	emit := func(page encodedPage) error {
		timings.Encode += milliseconds(page.elapsed)
		written += len(page.png)
		if len(page.png) > artifactLimit || written > totalArtifactLimit {
			return pdfium.ErrLimit
		}
		var frame [4]byte
		binary.BigEndian.PutUint32(frame[:], uint32(len(page.png)))
		_, _ = out.Write(frame[:])
		_, err := out.Write(page.png)
		return err
	}
	var pending chan encodedPage
	for _, number := range pages {
		rasterStarted := time.Now()
		raster, err := document.Render(number, renderScale, maxRenderEdge)
		if err != nil {
			return err
		}
		timings.Raster += milliseconds(time.Since(rasterStarted))
		timings.Pages++
		if pending != nil {
			if err := emit(<-pending); err != nil {
				return err
			}
		}
		pending = make(chan encodedPage, 1)
		go func(raster *pdfium.Raster, done chan<- encodedPage) {
			encodeStarted := time.Now()
			png := pdfium.EncodePNG(raster, best)
			done <- encodedPage{png: png, elapsed: time.Since(encodeStarted)}
		}(raster, pending)
	}
	if err := emit(<-pending); err != nil {
		return err
	}
	timings.RSS = peakRSS()
	metrics, _ := json.Marshal(timings)
	var frame [8]byte
	binary.BigEndian.PutUint32(frame[:4], uint32(0xFFFFFFE2)) // -30: renderer metrics
	binary.BigEndian.PutUint32(frame[4:], uint32(len(metrics)))
	_, _ = out.Write(frame[:])
	_, err = out.Write(metrics)
	return err
}

func validatePages(pages []int, count int) error {
	if count < 1 || count > pageLimit || len(pages) == 0 || len(pages) > count {
		return errSelection
	}
	seen := make(map[int]bool, len(pages))
	for _, page := range pages {
		if page < 1 || page > count || seen[page] {
			return errSelection
		}
		seen[page] = true
	}
	return nil
}

func milliseconds(duration time.Duration) float64 { return float64(duration.Microseconds()) / 1000 }
