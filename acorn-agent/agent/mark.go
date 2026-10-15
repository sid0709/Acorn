package agent

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"strings"
)

// markedQuality is the JPEG quality of a screenshot with its actions drawn on it.
const markedQuality = 85

// digitFont draws the numbers 0-9, each 3 columns by 5 rows, so an action can be numbered
// on the screenshot without a font library.
var digitFont = [10][5]string{
	{"###", "# #", "# #", "# #", "###"},
	{" # ", "## ", " # ", " # ", "###"},
	{"###", "  #", "###", "#  ", "###"},
	{"###", "  #", "###", "  #", "###"},
	{"# #", "# #", "###", "  #", "  #"},
	{"###", "#  ", "###", "  #", "###"},
	{"###", "#  ", "###", "# #", "###"},
	{"###", "  #", "  #", "  #", "  #"},
	{"###", "# #", "###", "# #", "###"},
	{"###", "# #", "###", "  #", "###"},
}

// markScreenshot draws where each action points on the screenshot the model was shown: a
// ring and cross at a click, a line for a scroll, each numbered in order. It is for the
// person debugging a run: it shows, without guessing, where a click actually went.
func markScreenshot(dataURL string, actions []Action) ([]byte, error) {
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return nil, fmt.Errorf("the screenshot is not a data URL")
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return nil, fmt.Errorf("decode screenshot: %w", err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("read screenshot: %w", err)
	}
	canvas := image.NewRGBA(decoded.Bounds())
	draw.Draw(canvas, canvas.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	scale := max(1, canvas.Bounds().Dx()/700) // keep the marks legible on a wide screenshot
	thick := max(3, 2*scale)                  // thin lines vanish in JPEG compression
	for i, action := range actions {
		if action.X == nil || action.Y == nil {
			continue
		}
		x, y := int(*action.X), int(*action.Y)
		switch action.Kind {
		case KindScroll:
			drawLine(canvas, x, y, x+int(clampF(action.DX, 160*float64(scale))), y+int(clampF(action.DY, 160*float64(scale))), colorScroll, thick)
			drawRing(canvas, x, y, 6*scale, colorScroll, thick)
		case KindUpload:
			drawRing(canvas, x, y, 14*scale, colorUpload, thick)
			drawCross(canvas, x, y, 22*scale, colorUpload, thick)
		case KindHover:
			drawRing(canvas, x, y, 14*scale, colorHover, thick)
		default:
			drawRing(canvas, x, y, 14*scale, colorClick, thick)
			drawCross(canvas, x, y, 22*scale, colorClick, thick)
		}
		drawNumber(canvas, i+1, x+16*scale, y-26*scale, scale, colorLabel)
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: markedQuality}); err != nil {
		return nil, fmt.Errorf("encode marked screenshot: %w", err)
	}
	return out.Bytes(), nil
}

var (
	colorClick  = color.RGBA{R: 235, G: 30, B: 30, A: 255}
	colorScroll = color.RGBA{R: 30, G: 90, B: 235, A: 255}
	colorUpload = color.RGBA{R: 20, G: 160, B: 60, A: 255}
	colorHover  = color.RGBA{R: 170, G: 60, B: 200, A: 255}
	colorLabel  = color.RGBA{R: 255, G: 255, B: 0, A: 255}
)

func clampF(value, limit float64) float64 { return math.Max(-limit, math.Min(limit, value)) }

func set(img *image.RGBA, x, y int, c color.RGBA) {
	if image.Pt(x, y).In(img.Bounds()) {
		img.SetRGBA(x, y, c)
	}
}

func drawRing(img *image.RGBA, cx, cy, radius int, c color.RGBA, thickness int) {
	for y := -radius - thickness; y <= radius+thickness; y++ {
		for x := -radius - thickness; x <= radius+thickness; x++ {
			d := math.Hypot(float64(x), float64(y))
			if d >= float64(radius) && d <= float64(radius+thickness) {
				set(img, cx+x, cy+y, c)
			}
		}
	}
}

func drawCross(img *image.RGBA, cx, cy, arm int, c color.RGBA, thickness int) {
	for d := -arm; d <= arm; d++ {
		for t := 0; t < thickness; t++ {
			set(img, cx+d, cy+t, c)
			set(img, cx+t, cy+d, c)
		}
	}
}

func drawLine(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA, thickness int) {
	steps := int(math.Max(math.Abs(float64(x1-x0)), math.Abs(float64(y1-y0))))
	for i := 0; i <= steps; i++ {
		f := float64(i) / math.Max(1, float64(steps))
		x, y := x0+int(f*float64(x1-x0)), y0+int(f*float64(y1-y0))
		for t := 0; t < thickness; t++ {
			set(img, x+t, y, c)
			set(img, x, y+t, c)
		}
	}
}

// drawNumber writes a small number (a black box behind yellow digits) at the point.
func drawNumber(img *image.RGBA, n, x, y, scale int, c color.RGBA) {
	digits := fmt.Sprint(n)
	pixel := 3 * scale
	width := len(digits)*4*pixel + pixel
	for yy := -pixel; yy < 6*pixel; yy++ {
		for xx := -pixel; xx < width; xx++ {
			set(img, x+xx, y+yy, color.RGBA{A: 255})
		}
	}
	for i, r := range digits {
		glyph := digitFont[r-'0']
		for row, line := range glyph {
			for col, cell := range line {
				if cell != '#' {
					continue
				}
				for dy := 0; dy < pixel; dy++ {
					for dx := 0; dx < pixel; dx++ {
						set(img, x+(i*4+col)*pixel+dx, y+row*pixel+dy, c)
					}
				}
			}
		}
	}
}
