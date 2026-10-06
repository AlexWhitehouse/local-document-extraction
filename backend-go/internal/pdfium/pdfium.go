// Package pdfium binds the PDFium C API without cgo, so the processor still
// cross-compiles with CGO_ENABLED=0. PDFium is not thread-safe: one process
// owns one Library and calls it from one goroutine.
package pdfium

import (
	"errors"
	"fmt"
	"math"
	"os"
	"syscall"
	"unsafe"

	"github.com/ebitengine/purego"
)

const (
	bitmapBGR         = 2
	renderAnnotations = 0x01
	renderRGBOrder    = 0x10
	errorPassword     = 4
)

var ErrInvalid = errors.New("PDF could not be opened")
var ErrEncrypted = errors.New("PDF is encrypted")

type Library struct {
	initLibrary      func()
	loadDocument     func(data unsafe.Pointer, size uintptr, password unsafe.Pointer) uintptr
	lastError        func() uint32
	securityRevision func(document uintptr) int32
	pageCount        func(document uintptr) int32
	closeDocument    func(document uintptr)
	loadPage         func(document uintptr, index int32) uintptr
	closePage        func(page uintptr)
	pageWidth        func(page uintptr) float32
	pageHeight       func(page uintptr) float32
	createBitmap     func(width, height, format int32, buffer unsafe.Pointer, stride int32) uintptr
	fillBitmap       func(bitmap uintptr, left, top, width, height int32, color uint32) int32
	bitmapBuffer     func(bitmap uintptr) unsafe.Pointer
	bitmapStride     func(bitmap uintptr) int32
	destroyBitmap    func(bitmap uintptr)
	renderPage       func(bitmap, page uintptr, x, y, width, height, rotation, flags int32)
	initForms        func(document uintptr, info unsafe.Pointer) uintptr
	exitForms        func(forms uintptr)
	afterLoadPage    func(page, forms uintptr)
	beforeClosePage  func(page, forms uintptr)
	drawForms        func(forms, bitmap, page uintptr, x, y, width, height, rotation, flags int32)
	// FPDF_FORMFILLINFO version 1 with no callbacks. PDFium keeps this pointer
	// for the form environment's lifetime, so it lives outside the Go heap.
	formInfo []byte
}

// Open loads the shared library once per worker process.
func Open(path string) (library *Library, err error) {
	handle, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_LOCAL)
	if err != nil {
		return nil, fmt.Errorf("load PDFium %s: %w", path, err)
	}
	defer func() {
		// RegisterLibFunc panics for a missing symbol: an incompatible library.
		if recovered := recover(); recovered != nil {
			library, err = nil, fmt.Errorf("incompatible PDFium library: %v", recovered)
		}
	}()
	l := &Library{}
	bind := func(target any, name string) { purego.RegisterLibFunc(target, handle, name) }
	bind(&l.initLibrary, "FPDF_InitLibrary")
	bind(&l.loadDocument, "FPDF_LoadMemDocument64")
	bind(&l.lastError, "FPDF_GetLastError")
	bind(&l.securityRevision, "FPDF_GetSecurityHandlerRevision")
	bind(&l.pageCount, "FPDF_GetPageCount")
	bind(&l.closeDocument, "FPDF_CloseDocument")
	bind(&l.loadPage, "FPDF_LoadPage")
	bind(&l.closePage, "FPDF_ClosePage")
	bind(&l.pageWidth, "FPDF_GetPageWidthF")
	bind(&l.pageHeight, "FPDF_GetPageHeightF")
	bind(&l.createBitmap, "FPDFBitmap_CreateEx")
	bind(&l.fillBitmap, "FPDFBitmap_FillRect")
	bind(&l.bitmapBuffer, "FPDFBitmap_GetBuffer")
	bind(&l.bitmapStride, "FPDFBitmap_GetStride")
	bind(&l.destroyBitmap, "FPDFBitmap_Destroy")
	bind(&l.renderPage, "FPDF_RenderPageBitmap")
	bind(&l.initForms, "FPDFDOC_InitFormFillEnvironment")
	bind(&l.exitForms, "FPDFDOC_ExitFormFillEnvironment")
	bind(&l.afterLoadPage, "FORM_OnAfterLoadPage")
	bind(&l.beforeClosePage, "FORM_OnBeforeClosePage")
	bind(&l.drawForms, "FPDF_FFLDraw")
	l.formInfo, err = syscall.Mmap(-1, 0, 4096, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_ANON|syscall.MAP_PRIVATE)
	if err != nil {
		return nil, err
	}
	l.formInfo[0] = 1
	l.initLibrary()
	return l, nil
}

type Document struct {
	library *Library
	handle  uintptr
	forms   uintptr
	mapping []byte
}

// OpenFile maps an immutable source read-only; PDFium reads it in place.
func (l *Library) OpenFile(path string, maxBytes int64) (*Document, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxBytes {
		return nil, ErrLimit
	}
	mapping, err := syscall.Mmap(int(file.Fd()), 0, int(info.Size()), syscall.PROT_READ, syscall.MAP_PRIVATE)
	if err != nil {
		return nil, err
	}
	handle := l.loadDocument(unsafe.Pointer(&mapping[0]), uintptr(len(mapping)), nil)
	if handle == 0 {
		code := l.lastError()
		_ = syscall.Munmap(mapping)
		if code == errorPassword {
			return nil, ErrEncrypted
		}
		return nil, ErrInvalid
	}
	document := &Document{library: l, handle: handle, mapping: mapping}
	if l.securityRevision(handle) != -1 {
		document.Close()
		return nil, ErrEncrypted
	}
	return document, nil
}

func (d *Document) PageCount() int { return int(d.library.pageCount(d.handle)) }

func (d *Document) Close() {
	if d.forms != 0 {
		d.library.exitForms(d.forms)
	}
	d.library.closeDocument(d.handle)
	_ = syscall.Munmap(d.mapping)
}

var ErrLimit = errors.New("PDF exceeds rendering limits")

// Raster is an opaque page as PNG scanlines: a zero filter byte, then gray or
// RGB samples. Opaque grayscale pages use one channel; exact pixels are kept.
type Raster struct {
	Width, Height int
	Gray          bool
	Rows          []byte
}

// Render rasterizes a 1-based page at up to scale, keeping both edges within
// maxEdge. Annotations and form-field appearances are drawn over white.
func (d *Document) Render(number int, scale float64, maxEdge int) (*Raster, error) {
	l := d.library
	if d.forms == 0 {
		d.forms = l.initForms(d.handle, unsafe.Pointer(&l.formInfo[0]))
	}
	page := l.loadPage(d.handle, int32(number-1))
	if page == 0 {
		return nil, ErrInvalid
	}
	defer l.closePage(page)
	if d.forms != 0 {
		l.afterLoadPage(page, d.forms)
		defer l.beforeClosePage(page, d.forms)
	}
	width, height := float64(l.pageWidth(page)), float64(l.pageHeight(page))
	if !(width > 0 && height > 0) || math.IsInf(width, 0) || math.IsInf(height, 0) {
		return nil, ErrLimit
	}
	scale = min(scale, float64(maxEdge)/width, float64(maxEdge)/height)
	w, h := int(math.Ceil(width*scale)), int(math.Ceil(height*scale))
	if w < 1 || h < 1 || w > maxEdge || h > maxEdge {
		return nil, ErrLimit
	}
	bitmap := l.createBitmap(int32(w), int32(h), bitmapBGR, nil, 0)
	if bitmap == 0 {
		return nil, ErrLimit
	}
	defer l.destroyBitmap(bitmap)
	l.fillBitmap(bitmap, 0, 0, int32(w), int32(h), 0xFFFFFFFF)
	flags := int32(renderAnnotations | renderRGBOrder)
	l.renderPage(bitmap, page, 0, 0, int32(w), int32(h), 0, flags)
	if d.forms != 0 {
		l.drawForms(d.forms, bitmap, page, 0, 0, int32(w), int32(h), 0, flags)
	}
	stride := int(l.bitmapStride(bitmap))
	if stride < w*3 {
		return nil, ErrInvalid
	}
	return scanlines(unsafe.Slice((*byte)(l.bitmapBuffer(bitmap)), stride*h), w, h, stride), nil
}

func scanlines(pixels []byte, w, h, stride int) *Raster {
	gray := true
	for y := 0; y < h && gray; y++ {
		row := pixels[y*stride : y*stride+w*3]
		for x := 0; x < len(row); x += 3 {
			if row[x] != row[x+1] || row[x] != row[x+2] {
				gray = false
				break
			}
		}
	}
	channels := 3
	if gray {
		channels = 1
	}
	rowBytes := w*channels + 1
	rows := make([]byte, rowBytes*h)
	for y := 0; y < h; y++ {
		source := pixels[y*stride : y*stride+w*3]
		destination := rows[y*rowBytes+1 : (y+1)*rowBytes]
		if gray {
			for x := range destination {
				destination[x] = source[x*3]
			}
		} else {
			copy(destination, source)
		}
	}
	return &Raster{Width: w, Height: h, Gray: gray, Rows: rows}
}
