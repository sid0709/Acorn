package acornapi

import (
	"log/slog"
	"net/http"

	"github.com/sid0709/OpenSeat/acorn-backend/selector"
)

// maxChoiceItems bounds one batch request from the extension.
const maxChoiceItems = 120

// pickOptions decides a form's choice fields in one SelectorGateway (Jev) batch,
// right after uploads finish. A failed batch is data: each step then decides alone.
func (s *Server) pickOptions(w http.ResponseWriter, r *http.Request) {
	session, ok := s.session(w, r)
	if !ok {
		return
	}
	var body struct {
		Items []struct {
			ID       int      `json:"id"`
			Field    string   `json:"field"`
			Intended string   `json:"intended"`
			Options  []string `json:"options"`
			Multiple bool     `json:"multiple"`
		} `json:"items"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.Items) == 0 || len(body.Items) > maxChoiceItems {
		writeError(w, http.StatusBadRequest, "items must list 1-120 choice fields")
		return
	}
	applicant, ok := s.applicant(w, r, session)
	if !ok {
		return
	}
	gateway, ok := s.selectorFor(w, r, session.User.ID)
	if !ok {
		return
	}
	items := make([]selector.ChoiceItem, 0, len(body.Items))
	for _, item := range body.Items {
		items = append(items, selector.ChoiceItem{ID: item.ID, Field: item.Field, Intended: item.Intended, Options: item.Options, Multiple: item.Multiple})
	}
	picks, usage, err := gateway.PickBatch(s.withUsage(r, session.User.ID), applicant, items)
	if err != nil {
		slog.Warn("acorn pick-options failed", "error", err)
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "picks": []any{}, "error": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(picks))
	for _, pick := range picks {
		out = append(out, map[string]any{"id": pick.ID, "options": pick.Options})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "picks": out, "model": gateway.Model(), "usage": decisionUsage(gateway.Model(), usage)})
}
