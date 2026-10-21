package agent

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"math"
)

// A fast-fill plan is planned on a survey, and the page can change shape between the survey and an
// action: a question that appears, an error message under a field. Every point below the change
// moves down (or up) by the height of what appeared; sideways it hardly moves. So when the page is
// not the height the survey saw, the extension takes a screenshot at the place the action expects
// its target and asks here where the target is now. It is found by its anchor (anchor.go): the crop of
// the survey around the target, which reaches up to the label. The crop is matched down the screenshot
// (and a little sideways) by normalised cross-correlation, so it does not matter whether the picture
// is a little brighter or the field was filled. A target that is not found, or is found in two places,
// is not guessed at: the plan stops there and the model looks (docs 19.4m).

const (
	// locateShrink is how many times smaller than the screenshot the picture is that the match is made
	// on: 4 times fewer pixels to compare, and a point still within a couple of pixels.
	locateShrink = 2
	// locateSlackPx is how far sideways (screenshot pixels) a target may have moved: a scrollbar that
	// appears narrows the page by about 15.
	locateSlackPx = 24
	// locateMinScore is the correlation a place must reach to be the target (1 is identical).
	locateMinScore = 0.90
	// locateAmbiguity is how much better the best place must be than the best place elsewhere on the
	// screen: two as good are two places the target might be, and which is not known.
	locateAmbiguity = 0.04
	// locateAloneScore is the correlation a place must reach when only one of an anchor's crops found
	// it: a crop that stands alone, unconfirmed by the other, must match nearly as well as the survey itself.
	locateAloneScore = 0.95
	// locateMinContrast is the least spread of grey levels a crop needs to be found by: a plain white
	// crop matches every plain white place.
	locateMinContrast = 6.0
)

// LocateRequest asks where the target of an action is on a screenshot taken now.
type LocateRequest struct {
	ActionID   string  `json:"actionId"`
	Screenshot string  `json:"screenshot"`
	ScrollY    float64 `json:"scrollY"`
}

// LocateResult says where: the point in the screenshot's pixels, how well the crop matched there,
// and, when it was not found, why.
type LocateResult struct {
	Found  bool    `json:"found"`
	X      float64 `json:"x,omitempty"`
	Y      float64 `json:"y,omitempty"`
	Score  float64 `json:"score,omitempty"`
	Reason string  `json:"reason,omitempty"`
}

// Locate finds the target of an action of the plan being carried out on a screenshot the extension took
// when the page was not the shape the survey saw. It makes no model call.
func (a *Agent) Locate(ctx context.Context, id string, request LocateRequest) (LocateResult, error) {
	s, ok := a.sessions.get(id)
	if !ok {
		return LocateResult{}, ErrNoSession
	}
	s.mu.Lock()
	target, known := s.anchors[request.ActionID]
	s.touched = a.now()
	s.mu.Unlock()
	if !known {
		return LocateResult{Reason: "the agent has no picture of that target"}, nil
	}
	raw, readable := decodeDataURL(request.Screenshot)
	if !readable {
		return LocateResult{}, fmt.Errorf("%w: the screenshot is not an image", ErrBadObservation)
	}
	screen, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return LocateResult{}, fmt.Errorf("%w: the screenshot is not readable: %v", ErrBadObservation, err)
	}
	found := locateAnchor(target, screen)
	if found.Found {
		slog.Info(fmt.Sprintf("%s: found the target of %s again, moved %+.0f px down the page (match %.2f).",
			runName(id), request.ActionID, found.Y-float64(target.Point.Y)+request.ScrollY-target.ScrollY, found.Score))
	} else {
		slog.Warn(fmt.Sprintf("%s: could not find the target of %s again: %s.", runName(id), request.ActionID, found.Reason))
	}
	return found, nil
}

// grey is a picture reduced to one grey level per pixel.
type grey struct {
	w, h int
	pix  []float32
}

// reduce is img as grey levels with each locateShrink-by-locateShrink block averaged.
func reduce(img image.Image) grey {
	bounds := img.Bounds()
	w, h := bounds.Dx()/locateShrink, bounds.Dy()/locateShrink
	out := grey{w: w, h: h, pix: make([]float32, w*h)}
	level := func(x, y int) float32 { return luminance(img, bounds.Min.X+x, bounds.Min.Y+y) }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var sum float32
			for dy := 0; dy < locateShrink; dy++ {
				for dx := 0; dx < locateShrink; dx++ {
					sum += level(x*locateShrink+dx, y*locateShrink+dy)
				}
			}
			out.pix[y*w+x] = sum / (locateShrink * locateShrink)
		}
	}
	return out
}

// luminance is the grey level (0 to 255) of a pixel.
func luminance(img image.Image, x, y int) float32 {
	switch pic := img.(type) {
	case *image.YCbCr:
		return float32(pic.Y[pic.YOffset(x, y)])
	case *image.Gray:
		return float32(pic.GrayAt(x, y).Y)
	}
	r, g, b, _ := img.At(x, y).RGBA()
	return float32(0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(b>>8))
}

// integral holds running sums of a picture and of its squares, so the mean and spread of any window
// of it cost four reads.
type integral struct {
	w          int
	sum, sumSq []float64
}

func integrate(g grey) integral {
	stride := g.w + 1
	in := integral{w: stride, sum: make([]float64, stride*(g.h+1)), sumSq: make([]float64, stride*(g.h+1))}
	for y := 0; y < g.h; y++ {
		var row, rowSq float64
		for x := 0; x < g.w; x++ {
			v := float64(g.pix[y*g.w+x])
			row += v
			rowSq += v * v
			in.sum[(y+1)*stride+x+1] = in.sum[y*stride+x+1] + row
			in.sumSq[(y+1)*stride+x+1] = in.sumSq[y*stride+x+1] + rowSq
		}
	}
	return in
}

// window is the sum and sum of squares of the w by h window at (x, y).
func (in integral) window(x, y, w, h int) (sum, sumSq float64) {
	a, b := y*in.w+x, y*in.w+x+w
	c, d := (y+h)*in.w+x, (y+h)*in.w+x+w
	return in.sum[d] - in.sum[b] - in.sum[c] + in.sum[a], in.sumSq[d] - in.sumSq[b] - in.sumSq[c] + in.sumSq[a]
}

// locateAgreementPx is how far apart (screenshot pixels) the places two crops of one target point to may be
// and still be the same place.
const locateAgreementPx = 6

// locateAnchor is where the anchor's target is on a screenshot. Each crop of the anchor finds it on its
// own: a crop that lies on something the plan itself changed (the field above, once filled) finds nothing,
// and that is not a reason to doubt a crop that finds it. When two crops find it, they must agree: two
// places is not a place.
func locateAnchor(target anchor, screen image.Image) LocateResult {
	hay := reduce(screen)
	in := integrate(hay)
	var found []LocateResult
	var failed LocateResult
	for _, crop := range target.Crops {
		result := locateCrop(crop, target.Point, hay, in)
		if !result.Found {
			if result.Score >= failed.Score || failed.Reason == "" {
				failed = result
			}
			continue
		}
		found = append(found, result)
	}
	switch {
	case len(found) == 0 && failed.Reason == "":
		return LocateResult{Reason: "the agent has no picture of that target"}
	case len(found) == 0:
		return failed
	}
	best := found[0]
	if len(found) == 1 && len(target.Crops) > 1 && best.Score < locateAloneScore {
		return LocateResult{Score: best.Score, Reason: fmt.Sprintf("only one of two pictures of it matched, and only by %.2f", best.Score)}
	}
	for _, result := range found[1:] {
		if abs(int(result.Y)-int(best.Y)) > locateAgreementPx {
			return LocateResult{Score: math.Max(best.Score, result.Score), Reason: fmt.Sprintf("two pictures of it point to different places (%.0f and %.0f px down the screen)", best.Y, result.Y)}
		}
		if result.Score > best.Score {
			best = result
		}
	}
	return best
}

// locateCrop is where the target is on a screenshot (already reduced, with its integral image), by one crop.
func locateCrop(target anchorCrop, point image.Point, hay grey, in integral) LocateResult {
	crop, err := jpeg.Decode(bytes.NewReader(target.JPEG))
	if err != nil {
		return LocateResult{Reason: "the picture of the target is not readable"}
	}
	template := reduce(crop)
	if template.w < 4 || template.h < 4 || hay.w < template.w || hay.h < template.h {
		return LocateResult{Reason: "the picture of the target is larger than the screen"}
	}
	n := float64(template.w * template.h)
	var mean float64
	for _, v := range template.pix {
		mean += float64(v)
	}
	mean /= n
	centred := make([]float32, len(template.pix))
	var energy float64
	for i, v := range template.pix {
		centred[i] = v - float32(mean)
		energy += float64(centred[i]) * float64(centred[i])
	}
	if math.Sqrt(energy/n) < locateMinContrast {
		return LocateResult{Reason: "the target's surroundings are too plain to be found by"}
	}

	slack := locateSlackPx / locateShrink
	x0 := target.Rect.Min.X / locateShrink
	xFrom, xTo := max(0, x0-slack), min(hay.w-template.w, x0+slack)
	rows := hay.h - template.h + 1
	best := make([]float64, rows)
	bestX := make([]int, rows)
	for oy := 0; oy < rows; oy++ {
		best[oy] = -1
		for ox := xFrom; ox <= xTo; ox++ {
			sum, sumSq := in.window(ox, oy, template.w, template.h)
			spread := sumSq - sum*sum/n
			if spread < 1 {
				continue
			}
			var cross float64
			for ty := 0; ty < template.h; ty++ {
				row := (oy+ty)*hay.w + ox
				mine := ty * template.w
				for tx := 0; tx < template.w; tx++ {
					cross += float64(centred[mine+tx]) * float64(hay.pix[row+tx])
				}
			}
			if score := cross / math.Sqrt(energy*spread); score > best[oy] {
				best[oy], bestX[oy] = score, ox
			}
		}
	}
	top := 0
	for oy := range best {
		if best[oy] > best[top] {
			top = oy
		}
	}
	if best[top] < locateMinScore {
		return LocateResult{Score: best[top], Reason: fmt.Sprintf("nothing on the screen looks like it (best match %.2f)", best[top])}
	}
	// A second place as good, away from the first, is a place the target might equally be.
	apart := template.h / 2
	second := -1.0
	for oy := range best {
		if oy < top-apart || oy > top+apart {
			second = math.Max(second, best[oy])
		}
	}
	if second >= best[top]-locateAmbiguity {
		return LocateResult{Score: best[top], Reason: fmt.Sprintf("two places look like it (%.2f and %.2f)", best[top], second)}
	}
	inCrop := point.Sub(target.Rect.Min)
	return LocateResult{
		Found: true,
		X:     float64(bestX[top]*locateShrink + inCrop.X),
		Y:     float64(top*locateShrink + inCrop.Y),
		Score: best[top],
	}
}
