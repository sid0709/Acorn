package agent

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"strings"
)

// A survey is up to eight screenshots, and the model must say which of them a point is on. Counting
// images is where it slips (a recorded run put the first name field on screen 7 when it was on
// screen 6, and typed the applicant's name into another question), so each screenshot has its number
// written in its top left corner before the model sees it. The numbers are drawn on a copy: the
// survey itself, and the crops taken from it, are untouched.

const (
	// badgePixel is the size of one pixel of the badge's letters, in screenshot pixels.
	badgePixel = 5
	// badgeQuality is the JPEG quality of a screenshot with its badge.
	badgeQuality = 75
)

// badgeColors are a black plate under yellow letters, the same as the numbers drawn on a marked
// screenshot, which a model already reads.
var (
	badgePlate  = color.RGBA{A: 255}
	badgeLetter = colorLabel
)

// badgeFont is the letters and digits a badge says ("SCREEN 6 OF 8"), each 5 rows high.
var badgeFont = map[rune][5]string{
	'S': {"###", "#  ", "###", "  #", "###"},
	'C': {"###", "#  ", "#  ", "#  ", "###"},
	'R': {"###", "# #", "###", "## ", "# #"},
	'E': {"###", "#  ", "###", "#  ", "###"},
	'N': {"#   #", "##  #", "# # #", "#  ##", "#   #"},
	'O': {"###", "# #", "# #", "# #", "###"},
	'F': {"###", "#  ", "###", "#  ", "#  "},
	' ': {"  ", "  ", "  ", "  ", "  "},
}

func init() {
	for digit, glyph := range digitFont {
		badgeFont[rune('0'+digit)] = glyph
	}
}

// badgeText is what the badge of screen n of total says.
func badgeText(n, total int) string { return fmt.Sprintf("SCREEN %d OF %d", n, total) }

// drawBadge writes text in the top left corner of img, on a black plate.
func drawBadge(img *image.RGBA, text string) {
	var width int
	for _, r := range text {
		width += len(badgeFont[r][0]) + 1
	}
	plate := image.Rect(0, 0, (width+2)*badgePixel, 9*badgePixel).Intersect(img.Bounds())
	draw.Draw(img, plate, image.NewUniform(badgePlate), image.Point{}, draw.Src)
	x := badgePixel
	for _, r := range text {
		glyph := badgeFont[r]
		for row, line := range glyph {
			for col, cell := range line {
				if cell != '#' {
					continue
				}
				for dy := 0; dy < badgePixel; dy++ {
					for dx := 0; dx < badgePixel; dx++ {
						set(img, x+col*badgePixel+dx, (2+row)*badgePixel+dy-badgePixel/2, badgeLetter)
					}
				}
			}
		}
		x += (len(glyph[0]) + 1) * badgePixel
	}
}

// badged is a screenshot (a data URL) with its badge, or the screenshot itself when it cannot be read:
// a badge is a help for the model, not a reason to refuse a look.
func badged(dataURL string, n, total int) string {
	raw, ok := decodeDataURL(dataURL)
	if !ok {
		return dataURL
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return dataURL
	}
	canvas := image.NewRGBA(decoded.Bounds())
	draw.Draw(canvas, canvas.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	drawBadge(canvas, badgeText(n, total))
	var out bytes.Buffer
	if err := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: badgeQuality}); err != nil {
		return dataURL
	}
	return "data:image/jpeg;base64," + encodeBase64(out.Bytes())
}

// badgedImages are the survey's screenshots, in order, each with its number written on it.
func badgedImages(obs Observation) []string {
	images := make([]string, len(obs.Survey))
	for i, screen := range obs.Survey {
		images[i] = badged(screen.Screenshot, i+1, len(obs.Survey))
	}
	return images
}

// badgeNote tells the model the numbers are on the pictures.
func badgeNote() string {
	return "Each screenshot has its number written on a black plate in its top left corner (" + strings.ToLower(badgeText(1, 8)) + "): use that number as \"screen\"."
}
