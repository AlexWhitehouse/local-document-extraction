// Command document-extraction-pdf is the application's only PDF engine: an
// isolated PDFium process that inspects uploads, renders pages and previews,
// verifies blank pages and copies page subsets into new PDFs. The Go processor
// and the Bun API both run it. A crash, deadline or memory breach loses one
// process.
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"sync/atomic"
	"time"

	"document-extraction.local/backend/internal/pdfium"
)

const (
	sourceLimit        = 32 << 20
	artifactLimit      = 32 << 20
	totalArtifactLimit = 64 << 20
	metadataLimit      = 128 << 10
	previewLimit       = 16 << 20
	pageLimit          = 10_000
	groupLimit         = 100
	// Requests with more than 20 images reject edges above 2000 px at some
	// providers. 2× (144 DPI) is kept for ordinary page sizes.
	renderScale   = 2
	maxRenderEdge = 2000
)

// Callers tune recycling and the in-operation memory ceiling per pool: upload
// inspectors use a lower ceiling than renderers.
var (
	recycleRSS = megabytes("GO_PDF_WORKER_RECYCLE_RSS_MIB", 384)
	hardRSS    = megabytes("GO_PDF_WORKER_HARD_RSS_MIB", 1024)
)

func megabytes(name string, fallback uint64) uint64 {
	if value, err := strconv.ParseUint(os.Getenv(name), 10, 32); err == nil && value > 0 {
		return value << 20
	}
	return fallback << 20
}

var errSelection = errors.New("invalid page selection")

func main() {
	if len(os.Args) != 2 || os.Args[1] != "serve" {
		os.Stderr.WriteString("usage: document-extraction-pdf serve\n")
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

var peak atomic.Uint64

// peakRSS is the largest resident size sampled since this process started.
func peakRSS() uint64 {
	current := currentRSS()
	for previous := peak.Load(); current > previous; previous = peak.Load() {
		if peak.CompareAndSwap(previous, current) {
			return current
		}
	}
	return peak.Load()
}

type renderRequest struct {
	Operation   string  `json:"operation"`
	SourcePath  string  `json:"source_path"`
	Page        int     `json:"page"`
	Pages       []int   `json:"pages"`
	Groups      [][]int `json:"groups"`
	Compression string  `json:"compression"`
	// source holds inline bytes when the source frame is not empty.
	source []byte
}

func (r renderRequest) open(library *pdfium.Library) (*pdfium.Document, error) {
	if r.source != nil {
		return library.OpenBytes(r.source, sourceLimit)
	}
	return library.OpenFile(r.SourcePath, sourceLimit)
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
		// An empty source frame means the metadata names a private source path.
		if _, err := io.ReadFull(in, header); err != nil {
			return
		}
		var source []byte
		if size := binary.BigEndian.Uint32(header); size > sourceLimit {
			return
		} else if size > 0 {
			source = make([]byte, size)
			if _, err := io.ReadFull(in, source); err != nil {
				return
			}
		}
		var request renderRequest
		if err := json.Unmarshal(metadata, &request); err != nil {
			fail(out, 21)
			return
		}
		request.source = source
		var err error
		switch request.Operation {
		case "inspect":
			err = inspect(library, request, out)
		case "render":
			err = render(library, request, out)
		case "preview":
			err = preview(library, request, out)
		case "blank":
			err = blank(library, request, out)
		case "materialize":
			err = materialize(library, request, out)
		default:
			fail(out, 21)
			return
		}
		if err != nil {
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
	document, err := request.open(library)
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

// materialize writes one PDF per group. Like the pdf-lib materializer it
// replaced, each group's pages are unique, in range and kept in ascending order,
// and no page appears in two groups.
func materialize(library *pdfium.Library, request renderRequest, out *bufio.Writer) error {
	document, err := request.open(library)
	if err != nil {
		return err
	}
	defer document.Close()
	count := document.PageCount()
	if len(request.Groups) == 0 || len(request.Groups) > groupLimit {
		return errSelection
	}
	used := make(map[int]bool)
	for _, group := range request.Groups {
		if err := validatePages(group, count); err != nil {
			return err
		}
		for _, page := range group {
			if used[page] {
				return errSelection
			}
			used[page] = true
		}
	}
	written := 0
	for _, group := range request.Groups {
		pages := slices.Sorted(slices.Values(group))
		data, err := document.Subset(pages, min(artifactLimit, totalArtifactLimit-written))
		if err != nil {
			return err
		}
		written += len(data)
		if err := writeArtifact(out, data); err != nil {
			return err
		}
	}
	return nil
}

func writeArtifact(out *bufio.Writer, data []byte) error {
	var frame [4]byte
	binary.BigEndian.PutUint32(frame[:], uint32(len(data)))
	_, _ = out.Write(frame[:])
	_, err := out.Write(data)
	return err
}

// inspect admits an upload: PDFium must open it and read every page's size from
// its page dictionary. Content is not parsed, so streams the application never
// needs are never decoded; the process memory ceiling and the caller's deadline
// bound whatever PDFium does decode.
func inspect(library *pdfium.Library, request renderRequest, out *bufio.Writer) error {
	document, err := request.open(library)
	if err != nil {
		return err
	}
	defer document.Close()
	count := document.PageCount()
	if count < 1 {
		return pdfium.ErrInvalid
	}
	if count > pageLimit {
		return pdfium.ErrLimit
	}
	for page := 1; page <= count; page++ {
		width, height, err := document.PageSize(page)
		if err != nil {
			return err
		}
		if !(width > 0 && height > 0) || math.IsInf(width, 0) || math.IsInf(height, 0) {
			return pdfium.ErrInvalid
		}
	}
	return writeArtifact(out, []byte(fmt.Sprintf(`{"pages":%d}`, count)))
}

// preview renders one page as it is sent to models.
func preview(library *pdfium.Library, request renderRequest, out *bufio.Writer) error {
	document, err := request.open(library)
	if err != nil {
		return err
	}
	defer document.Close()
	if err := validatePages([]int{request.Page}, document.PageCount()); err != nil {
		return err
	}
	raster, err := document.Render(request.Page, renderScale, maxRenderEdge)
	if err != nil {
		return err
	}
	png := pdfium.EncodePNG(raster, false)
	if len(png) > previewLimit {
		png = pdfium.EncodePNG(raster, true)
	}
	if len(png) > previewLimit {
		return pdfium.ErrLimit
	}
	return writeArtifact(out, png)
}

// blank returns the requested pages verified blank, as a JSON array.
func blank(library *pdfium.Library, request renderRequest, out *bufio.Writer) error {
	document, err := request.open(library)
	if err != nil {
		return err
	}
	defer document.Close()
	if err := validatePages(request.Pages, document.PageCount()); err != nil {
		return err
	}
	verified := []int{}
	for _, page := range request.Pages {
		empty, err := document.Blank(page, renderScale, maxRenderEdge)
		if err != nil {
			return err
		}
		if empty {
			verified = append(verified, page)
		}
	}
	data, err := json.Marshal(verified)
	if err != nil {
		return err
	}
	return writeArtifact(out, data)
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
