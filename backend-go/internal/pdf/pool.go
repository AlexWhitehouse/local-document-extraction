// Package pdf supervises isolated PDF processes: PDFium renderers and the Bun
// pdf-lib workers that materialize subset PDFs.
package pdf

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
)

var ErrArtifactLimit = errors.New("PDF artifacts exceed limit")

const maxArtifact = 32 << 20
const maxArtifacts = 64 << 20

type worker struct {
	cmd      *exec.Cmd
	lastUsed time.Time
	in       io.WriteCloser
	out      io.ReadCloser
}
type Pool struct {
	admission    *admission
	command, env []string
	renderer     bool
	sweepStop    chan struct{}
	sweepDone    chan struct{}
	slots        chan *worker
	mu           sync.Mutex
	closed       bool
	wg           sync.WaitGroup
	Operations   atomic.Uint64
	Starts       atomic.Uint64
	LoadMicros   atomic.Uint64
	RasterMicros atomic.Uint64
	EncodeMicros atomic.Uint64
	Pages        atomic.Uint64
	Recycles     atomic.Uint64
	PeakRSS      atomic.Uint64
}

// New supervises up to capacity processes running command. Renderers report
// phase metrics and run without the materialization deadline.
func New(command, env []string, capacity int, renderer bool) *Pool {
	p := &Pool{admission: &admission{capacity: capacity}, command: command, env: env, renderer: renderer, slots: make(chan *worker, capacity), sweepStop: make(chan struct{}), sweepDone: make(chan struct{})}
	for i := 0; i < capacity; i++ {
		p.slots <- nil
	}
	go p.sweep()
	return p
}

func (p *Pool) start() (*worker, error) {
	cmd := exec.Command(p.command[0], p.command[1:]...)
	cmd.Stderr = io.Discard
	cmd.Env = append(os.Environ(), p.env...)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		in.Close()
		out.Close()
		return nil, err
	}
	p.Starts.Add(1)
	return &worker{cmd: cmd, in: in, out: out, lastUsed: time.Now()}, nil
}

func stop(w *worker) {
	if w == nil {
		return
	}
	w.in.Close()
	w.out.Close()
	w.cmd.Process.Kill()
	w.cmd.Wait()
}

// Run writes artifacts into a private task directory, never into authoritative
// source storage. The durable adapter promotes only accepted child sources.
func (p *Pool) Run(ctx context.Context, source, dir string, metadata any) ([]string, error) {
	return p.RunPriority(ctx, source, dir, metadata, false, nil)
}

func (p *Pool) RunPriority(ctx context.Context, source, dir string, metadata any, continuation bool, reserve func() error) ([]string, error) {
	release, err := p.Admit(ctx, continuation)
	if err != nil {
		return nil, err
	}
	defer release()
	return p.RunAdmitted(ctx, source, dir, metadata, reserve)
}

// TryAdmit takes a free slot without waiting or overtaking queued work.
func (p *Pool) TryAdmit() (func(), bool) {
	if !p.track() {
		return nil, false
	}
	if !p.admission.tryAcquire() {
		p.wg.Done()
		return nil, false
	}
	return p.releaser(), true
}

// Admit waits for a slot: two continuation turns per new-document turn, FIFO
// within each class.
func (p *Pool) Admit(ctx context.Context, continuation bool) (func(), error) {
	if !p.track() {
		return nil, errors.New("PDF pool closed")
	}
	if err := p.admission.acquire(ctx, continuation); err != nil {
		p.wg.Done()
		return nil, err
	}
	return p.releaser(), nil
}

func (p *Pool) track() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return false
	}
	p.wg.Add(1)
	return true
}

func (p *Pool) releaser() func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			p.admission.release()
			p.wg.Done()
		})
	}
}

// RunAdmitted runs one operation inside a slot obtained from Admit or TryAdmit.
func (p *Pool) RunAdmitted(ctx context.Context, source, dir string, metadata any, reserve func() error) ([]string, error) {
	if reserve != nil {
		if err := reserve(); err != nil {
			return nil, err
		}
	}
	var w *worker
	select {
	case w = <-p.slots:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	good := false
	defer func() {
		if !good {
			stop(w)
			w = nil
		}
		if w != nil {
			w.lastUsed = time.Now()
		}
		p.slots <- w
	}()
	var err error
	if w == nil {
		w, err = p.start()
		if err != nil {
			return nil, err
		}
	}
	if !p.renderer {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
	}
	finished := make(chan struct{})
	watchdogDone := make(chan struct{})
	process := w.cmd.Process
	go func() {
		defer close(watchdogDone)
		select {
		case <-ctx.Done():
			process.Kill()
		case <-finished:
		}
	}()
	defer func() { close(finished); <-watchdogDone }()
	file, err := os.Open(source)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() < 1 || info.Size() > 32<<20 {
		return nil, errors.New("PDF source exceeds limit")
	}
	meta, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	var descriptor map[string]any
	if err = json.Unmarshal(meta, &descriptor); err != nil {
		return nil, err
	}
	descriptor["source_path"] = source
	meta, err = json.Marshal(descriptor)
	if err != nil {
		return nil, err
	}
	if len(meta) > 128<<10 {
		return nil, errors.New("PDF operation metadata exceeds limit")
	}
	header := make([]byte, 4)
	binary.BigEndian.PutUint32(header, uint32(len(meta)))
	if _, err = w.in.Write(header); err != nil {
		return nil, err
	}
	if _, err = w.in.Write(meta); err != nil {
		return nil, err
	}
	binary.BigEndian.PutUint32(header, 0)
	if _, err = w.in.Write(header); err != nil {
		return nil, err
	}
	var paths []string
	complete := false
	defer func() {
		if !complete {
			for _, path := range paths {
				_ = os.Remove(path)
			}
		}
	}()
	total := int64(0)
	for {
		if _, err = io.ReadFull(w.out, header); err != nil {
			return nil, err
		}
		size := int64(int32(binary.BigEndian.Uint32(header)))
		if size == -30 && p.renderer {
			if _, err = io.ReadFull(w.out, header); err != nil {
				return nil, err
			}
			n := binary.BigEndian.Uint32(header)
			if n > 4096 {
				return nil, errors.New("invalid PDF metrics")
			}
			data := make([]byte, n)
			if _, err = io.ReadFull(w.out, data); err != nil {
				return nil, err
			}
			var metrics struct {
				Load, Raster, Encode float64
				Pages, RSS           uint64
			}
			if err = json.Unmarshal(data, &metrics); err != nil {
				return nil, err
			}
			p.LoadMicros.Add(uint64(metrics.Load * 1000))
			p.RasterMicros.Add(uint64(metrics.Raster * 1000))
			p.EncodeMicros.Add(uint64(metrics.Encode * 1000))
			p.Pages.Add(metrics.Pages)
			for old := p.PeakRSS.Load(); metrics.RSS > old; old = p.PeakRSS.Load() {
				if p.PeakRSS.CompareAndSwap(old, metrics.RSS) {
					break
				}
			}
			continue
		}
		if size == -22 {
			return nil, ErrArtifactLimit
		}
		if size < 0 {
			return nil, fmt.Errorf("PDF operation rejected (%d)", size)
		}
		if size == 0 {
			flag := make([]byte, 1)
			if _, err = io.ReadFull(w.out, flag); err != nil {
				return nil, err
			}
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			good = flag[0] == 0
			if !good {
				p.Recycles.Add(1)
			}
			p.Operations.Add(1)
			complete = true
			return paths, nil
		}
		total += size
		if size > maxArtifact || total > maxArtifacts || len(paths) >= 10000 {
			return nil, ErrArtifactLimit
		}
		out, err := os.CreateTemp(dir, "artifact-")
		if err != nil {
			return nil, err
		}
		paths = append(paths, out.Name())
		_, err = io.CopyN(out, w.out, size)
		closeErr := out.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
	}
}

func (p *Pool) Stats() map[string]uint64 {
	return map[string]uint64{"operations": p.Operations.Load(), "starts": p.Starts.Load(), "recycles": p.Recycles.Load(), "pages": p.Pages.Load(), "load_micros": p.LoadMicros.Load(), "raster_micros": p.RasterMicros.Load(), "encode_micros": p.EncodeMicros.Load(), "peak_worker_rss": p.PeakRSS.Load()}
}

func (p *Pool) Close() {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	close(p.sweepStop)
	<-p.sweepDone
	p.wg.Wait()
	for i := 0; i < cap(p.slots); i++ {
		stop(<-p.slots)
	}
}

func (p *Pool) sweep() {
	defer close(p.sweepDone)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-p.sweepStop:
			return
		case <-ticker.C:
			for i := 0; i < cap(p.slots); i++ {
				select {
				case w := <-p.slots:
					if w != nil && time.Since(w.lastUsed) >= 5*time.Second {
						stop(w)
						w = nil
					}
					p.slots <- w
				default:
				}
			}
		}
	}
}
