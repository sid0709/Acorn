package agent

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"strconv"

	"github.com/sid0709/acorn/acorn-agent/decide"
)

// An opened dropdown is read from its picture, as the applicant would read it: the decision model says
// whether a list is open, whether the box already shows the answer, and which option answers. The page's
// report of the open list (OpenList) is used for one thing only, where each option is drawn: every option
// wholly in view gets a number on a plate at its right end, so the model reads a number instead of counting
// rows, and the pick is a click on the box that number was drawn on. What the page says the options are
// called, which control has focus or what it holds decides nothing: a page's own list lies for a control it
// draws itself (a recorded run's dropdown hid a text input under its box, and was typed into). A list the page
// does not place is read by counting from its first option, as before.

const (
	// askShows is the question whether the dropdown's box already shows the answer.
	askShows = "shows_answer"
	// numberedQuality is the JPEG quality of a picture with its options numbered on it.
	numberedQuality = 85
	// optionPlateInsetPx is how far in from an option's right end its number is drawn (screenshot pixels).
	optionPlateInsetPx = 6
	// minPlateRowPx is the least height an option's box must have for its number to be drawn in it: a box
	// thinner than the plate is not an option a person reads.
	minPlateRowPx = 12
)

// listReading is what the decision model read in a picture of an opened dropdown: whether a list is open,
// whether the box shows the answer already, and the option to pick (0 for none). numbered is that the
// position is the number drawn on the option (its place in the page's list, from 1), not a count of rows.
type listReading struct {
	open, shows bool
	position    int
	numbered    bool
}

// numberedOptions are the options of the open list wholly in the picture, by their place in the page's list
// (from 0), with their boxes in the picture's own pixels.
func numberedOptions(list *OpenList, scrollY float64, vp Viewport) map[int]Rect {
	out := map[int]Rect{}
	if list == nil || len(list.Boxes) == 0 || len(list.Boxes) != len(list.Options) {
		return out
	}
	for i := range list.Boxes {
		box, ok := list.optionBox(i)
		if !ok || box.H < minPlateRowPx {
			continue
		}
		in := Rect{X: box.X - vp.ScrollX, Y: box.Y - scrollY, W: box.W, H: box.H}
		if in.X < 0 || in.Y < 0 || in.X+in.W > float64(vp.Width) || in.Y+in.H > float64(vp.Height) {
			continue
		}
		out[i] = in
	}
	return out
}

// numberedPicture is the picture with the number of each option drawn at its right end; ok is false when
// the picture cannot be read.
func numberedPicture(dataURL string, options map[int]Rect) (string, bool) {
	raw, ok := decodeDataURL(dataURL)
	if !ok {
		return "", false
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return "", false
	}
	canvas := image.NewRGBA(decoded.Bounds())
	draw.Draw(canvas, canvas.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	scale := max(1, canvas.Bounds().Dx()/700)
	for i, box := range options {
		n := i + 1
		pixel := 3 * scale
		width := len(strconv.Itoa(n))*4*pixel + pixel
		x := int(box.X+box.W) - width - optionPlateInsetPx*scale
		y := int(box.Y+box.H/2) - 5*pixel/2
		drawNumber(canvas, n, x, y, scale, colorLabel)
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: numberedQuality}); err != nil {
		return "", false
	}
	return "data:image/jpeg;base64," + encodeBase64(out.Bytes()), true
}

// readListPicture asks the decision model about a picture of an opened dropdown: whether a list is open,
// whether the box labelled label already shows answer (asked only when nothing was typed into it, since a
// box then shows what was typed), and which option answers. list places the options when the page drew
// them where it says; scrollY is the scroll the picture was taken at.
func (a *Agent) readListPicture(ctx context.Context, s *session, screenshot, answer, label string, list *OpenList, scrollY float64, askShown bool) (listReading, verdict, error) {
	picture := screenshot
	numbers := numberedOptions(list, scrollY, s.viewport)
	numbered := false
	if len(numbers) > 0 {
		if drawn, ok := numberedPicture(screenshot, numbers); ok {
			picture, numbered = drawn, true
		}
	}
	questions := map[string]decide.Question{
		askListOpen: decide.YesNo("Is a dropdown list of choices open on this page right now: a list of options shown below or above a control, so that one can be picked?"),
	}
	if askShown {
		questions[askShows] = decide.YesNo(fmt.Sprintf("Does the dropdown %s already show %q as its chosen value, in its own box (not only as an option of an open list)?", namedOr(label, "being set"), answer))
	}
	criteria := map[string]string{optionNone: "no option of the open list answers it"}
	instructions := "A dropdown list of choices is open on this page. Someone wants to choose the option that answers: " + strconv.Quote(answer) + ". "
	if numbered {
		instructions += "Each option in view has a number on a black plate at its right end. Which numbered option is it? "
		for i := range numbers {
			criteria[listedOptionPrefix+strconv.Itoa(i+1)] = "the option with the number " + strconv.Itoa(i+1) + " on its plate"
		}
	} else {
		instructions += "Counting from the first option of the list, which option is it? If the list is scrolled so that its first option is not visible, answer none. "
		for i := 1; i <= maxOptionPosition; i++ {
			criteria[listedOptionPrefix+strconv.Itoa(i)] = "option number " + strconv.Itoa(i) + " of the open list, counting from its first option"
		}
	}
	instructions += "Choose the option whose meaning matches: for a yes or no answer, the option that says yes or no, even when it goes on to explain. " +
		"An option that is exactly the answer beats one that only begins with it or contains it."
	questions[askOption] = decide.Question{Type: decide.TypeChoice, Instructions: instructions, Criteria: criteria}

	response, err := a.newScreen(s.key).Decide(ctx, decide.Request{State: checkState(picture), Questions: questions})
	check := verdict{response: response, prompt: fmt.Sprintf("which option of the open list answers %q (%s)", answer, readingKind(numbered))}
	out := listReading{numbered: numbered}
	if err != nil {
		return out, check, err
	}
	if open, ok := response.Answers[askListOpen]; ok && open.Noul != nil {
		out.open = *open.Noul >= listOpenMatch
	}
	if shown, ok := response.Answers[askShows]; ok && shown.Noul != nil {
		out.shows = *shown.Noul >= likely
	}
	key, ok := a.optionAccepted(response.Answers[askOption])
	if !ok {
		return out, check, nil
	}
	n, convErr := strconv.Atoi(key[len(listedOptionPrefix):])
	if convErr != nil || n < 1 {
		return out, check, nil
	}
	if numbered {
		if _, drawn := numbers[n-1]; !drawn {
			return out, check, nil
		}
	}
	out.position, out.open = n, true
	return out, check, nil
}

// readingKind says how a list was read, for the trace.
func readingKind(numbered bool) string {
	if numbered {
		return "options numbered on the picture"
	}
	return "options counted in the picture"
}

// namedOr is a control's label in quotes, else a phrase for it.
func namedOr(label, otherwise string) string {
	if label == "" || label == "(none)" {
		return otherwise
	}
	return strconv.Quote(label)
}
