package pdfium

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"hash/crc32"
)

// EncodePNG writes lossless 8-bit gray or RGB. Unfiltered scanlines with fast
// DEFLATE measured both faster and smaller than the Up filter on document pages.
func EncodePNG(raster *Raster, best bool) []byte {
	level := zlib.BestSpeed
	if best {
		level = zlib.BestCompression
	}
	var compressed bytes.Buffer
	compressed.Grow(len(raster.Rows) / 8)
	writer, _ := zlib.NewWriterLevel(&compressed, level)
	_, _ = writer.Write(raster.Rows)
	_ = writer.Close()
	header := make([]byte, 13)
	binary.BigEndian.PutUint32(header, uint32(raster.Width))
	binary.BigEndian.PutUint32(header[4:], uint32(raster.Height))
	header[8] = 8
	header[9] = 2
	if raster.Gray {
		header[9] = 0
	}
	var output bytes.Buffer
	output.Grow(compressed.Len() + 64)
	output.Write([]byte{137, 80, 78, 71, 13, 10, 26, 10})
	chunk(&output, "IHDR", header)
	chunk(&output, "IDAT", compressed.Bytes())
	chunk(&output, "IEND", nil)
	return output.Bytes()
}

func chunk(output *bytes.Buffer, kind string, data []byte) {
	var field [4]byte
	binary.BigEndian.PutUint32(field[:], uint32(len(data)))
	output.Write(field[:])
	checksum := crc32.NewIEEE()
	checksum.Write([]byte(kind))
	checksum.Write(data)
	output.WriteString(kind)
	output.Write(data)
	binary.BigEndian.PutUint32(field[:], checksum.Sum32())
	output.Write(field[:])
}
