package api

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"testing"

	"github.com/kannachi323/misty/server/db"
)

func TestFFmpegLibraryMediaProcessorRendersBoundedImage(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	source := image.NewRGBA(image.Rect(0, 0, 6, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 6; x++ {
			source.Set(x, y, color.RGBA{R: uint8(x * 30), G: uint8(y * 50), B: 80, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	processor, err := NewFFmpegLibraryMediaProcessor(ffmpeg)
	if err != nil {
		t.Fatal(err)
	}
	definition := db.DefaultLibraryEditDefinition()
	definition.Rotation = 90
	definition.Crop = &db.LibraryCrop{X: 0, Y: 0, Width: 0.5, Height: 1}
	rendered, err := processor.Render(context.Background(), bytes.NewReader(encoded.Bytes()), "image/png", int64(encoded.Len()), definition, 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	defer rendered.Cleanup()
	if rendered.MIMEType != "image/jpeg" || rendered.ByteSize < 1 || len(rendered.SHA256) != 64 {
		t.Fatalf("rendered metadata = %#v", rendered)
	}
	reader, err := rendered.Open()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(reader)
	_ = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 4 || decoded.Bounds().Dy() != 3 {
		t.Fatalf("rendered dimensions = %dx%d, want 4x3", decoded.Bounds().Dx(), decoded.Bounds().Dy())
	}
}

func TestFFmpegLibraryMediaProcessorCreatesMetadataStrippedPreview(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	source := image.NewRGBA(image.Rect(0, 0, 3200, 1200))
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, source, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	processor, err := NewFFmpegLibraryMediaProcessor(ffmpeg)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := processor.Preview(context.Background(), bytes.NewReader(encoded.Bytes()), int64(encoded.Len()), 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer preview.Cleanup()
	reader, err := preview.Open()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(reader)
	_ = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() != 1024 || decoded.Bounds().Dy() != 384 || preview.MIMEType != "image/jpeg" || preview.ByteSize > 25_000_000 {
		t.Fatalf("preview = %dx%d %#v", decoded.Bounds().Dx(), decoded.Bounds().Dy(), preview)
	}
}

func TestFFmpegLibraryMediaProcessorTranscodesTrimmedVideo(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	tempDir := t.TempDir()
	sourcePath := tempDir + "/source.mp4"
	command := exec.Command(ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:size=64x48:rate=24:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", sourcePath)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create source video: %v: %s", err, output)
	}
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	processor, err := NewFFmpegLibraryMediaProcessor(ffmpeg)
	if err != nil {
		t.Fatal(err)
	}
	definition := db.DefaultLibraryEditDefinition()
	definition.Trim = &db.LibraryTrim{Start: 0.2, End: 0.7}
	definition.FlipHorizontal = true
	definition.AutoEnhance = true
	definition.Filter = "dramatic"
	definition.Mute = true
	definition.PlaybackSpeed = 2
	rendered, err := processor.Render(context.Background(), bytes.NewReader(source), "video/mp4", int64(len(source)), definition, 5_000_000)
	if err != nil {
		t.Fatal(err)
	}
	defer rendered.Cleanup()
	if rendered.MIMEType != "video/mp4" || rendered.ByteSize < 1 || rendered.ByteSize > 5_000_000 || len(rendered.SHA256) != 64 {
		t.Fatalf("rendered video metadata = %#v", rendered)
	}
}
