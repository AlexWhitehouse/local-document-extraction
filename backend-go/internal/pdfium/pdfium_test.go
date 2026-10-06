package pdfium

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func openLibrary(t *testing.T) *Library {
	t.Helper()
	path := os.Getenv("PDFIUM_LIBRARY")
	if path == "" {
		name := "libpdfium.so"
		if runtime.GOOS == "darwin" {
			name = "libpdfium.dylib"
		}
		path, _ = filepath.Abs(filepath.Join("../../bin", name))
	}
	if _, err := os.Stat(path); err != nil {
		t.Skip("run bun run build:go to install PDFium")
	}
	library, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	return library
}

// writePDF builds a one-page document whose content stream fills the page.
func writePDF(t *testing.T, width, height int, rotate int, content string) string {
	t.Helper()
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Rotate %d /Contents 4 0 R >>", width, height, rotate),
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content),
	}
	var document bytes.Buffer
	document.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objects))
	for i, object := range objects {
		offsets[i] = document.Len()
		fmt.Fprintf(&document, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := document.Len()
	fmt.Fprintf(&document, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&document, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&document, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	path := filepath.Join(t.TempDir(), "fixture.pdf")
	if err := os.WriteFile(path, document.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func render(t *testing.T, library *Library, path string) *Raster {
	t.Helper()
	document, err := library.OpenFile(path, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer document.Close()
	if document.PageCount() != 1 {
		t.Fatalf("page count %d", document.PageCount())
	}
	raster, err := document.Render(1, 2, 2000)
	if err != nil {
		t.Fatal(err)
	}
	return raster
}

func TestGrayAndColorPagesRoundTripLosslessly(t *testing.T) {
	library := openLibrary(t)
	for _, test := range []struct {
		name    string
		content string
		gray    bool
	}{
		{"gray", "0.25 g 10 10 50 50 re f", true},
		{"color", "1 0 0 rg 10 10 50 50 re f", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			raster := render(t, library, writePDF(t, 100, 80, 0, test.content))
			if raster.Width != 200 || raster.Height != 160 || raster.Gray != test.gray {
				t.Fatalf("raster %dx%d gray=%v", raster.Width, raster.Height, raster.Gray)
			}
			for _, best := range []bool{false, true} {
				decoded, err := png.Decode(bytes.NewReader(EncodePNG(raster, best)))
				if err != nil {
					t.Fatal(err)
				}
				assertPixels(t, raster, decoded)
			}
		})
	}
}

func assertPixels(t *testing.T, raster *Raster, decoded image.Image) {
	t.Helper()
	channels := 3
	if raster.Gray {
		channels = 1
	}
	rowBytes := raster.Width*channels + 1
	for y := 0; y < raster.Height; y++ {
		for x := 0; x < raster.Width; x++ {
			r, g, b, a := decoded.At(x, y).RGBA()
			sample := raster.Rows[y*rowBytes+1+x*channels:]
			want := [3]byte{sample[0], sample[0], sample[0]}
			if !raster.Gray {
				want = [3]byte{sample[0], sample[1], sample[2]}
			}
			if a != 0xffff || byte(r>>8) != want[0] || byte(g>>8) != want[1] || byte(b>>8) != want[2] {
				t.Fatalf("pixel %d,%d decoded %v %v %v %v, want %v", x, y, r>>8, g>>8, b>>8, a>>8, want)
			}
		}
	}
}

func TestRotationAndEdgeLimit(t *testing.T) {
	library := openLibrary(t)
	rotated := render(t, library, writePDF(t, 100, 80, 90, "0 g 0 0 10 10 re f"))
	if rotated.Width != 160 || rotated.Height != 200 {
		t.Fatalf("rotated page %dx%d", rotated.Width, rotated.Height)
	}
	large := render(t, library, writePDF(t, 1500, 1200, 0, "0 g 0 0 10 10 re f"))
	if large.Width != 2000 || large.Height != 1600 {
		t.Fatalf("large page %dx%d", large.Width, large.Height)
	}
}

func TestInvalidSourcesAreRejected(t *testing.T) {
	library := openLibrary(t)
	path := filepath.Join(t.TempDir(), "invalid.pdf")
	if err := os.WriteFile(path, []byte("not a PDF"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := library.OpenFile(path, 32<<20); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid source: %v", err)
	}
	if _, err := library.OpenFile(writePDF(t, 10, 10, 0, ""), 10); !errors.Is(err, ErrLimit) {
		t.Fatalf("oversized source: %v", err)
	}
}

// writePages builds one blank page per width, so page order is observable.
func writePages(t *testing.T, widths ...int) string {
	t.Helper()
	kids := make([]string, len(widths))
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", ""}
	for i, width := range widths {
		kids[i] = fmt.Sprintf("%d 0 R", i+3)
		objects = append(objects, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d 100] >>", width))
	}
	objects[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(widths))
	var document bytes.Buffer
	document.WriteString("%PDF-1.7\n")
	offsets := make([]int, len(objects))
	for i, object := range objects {
		offsets[i] = document.Len()
		fmt.Fprintf(&document, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := document.Len()
	fmt.Fprintf(&document, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&document, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&document, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	path := filepath.Join(t.TempDir(), "pages.pdf")
	if err := os.WriteFile(path, document.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSubsetCopiesSelectedPagesInOrder(t *testing.T) {
	library := openLibrary(t)
	document, err := library.OpenFile(writePages(t, 101, 102, 103), 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer document.Close()
	data, err := document.Subset([]int{1, 3}, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "subset.pdf")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	subset, err := library.OpenFile(path, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer subset.Close()
	if subset.PageCount() != 2 {
		t.Fatalf("page count %d", subset.PageCount())
	}
	for i, width := range []int{101, 103} {
		raster, err := subset.Render(i+1, 1, 2000)
		if err != nil {
			t.Fatal(err)
		}
		if raster.Width != width {
			t.Fatalf("page %d width %d, want %d", i+1, raster.Width, width)
		}
	}
	if _, err := document.Subset([]int{2}, 64); !errors.Is(err, ErrLimit) {
		t.Fatalf("oversized subset returned %v", err)
	}
}
