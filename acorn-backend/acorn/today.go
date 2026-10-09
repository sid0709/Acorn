package acorn

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// FactToday is a field that asks for today's date (the date of signing or applying).
const FactToday = "today_date"

// pageTodayKey is where the extension puts the applicant's local date (YYYY-MM-DD):
// a server in another time zone can be a day off.
const pageTodayKey = "today"

// isoDate is the one date layout the extension sends and a type=date input takes.
const isoDate = "2006-01-02"

// Native input types that take a date in one fixed layout, whatever the page shows.
var nativeDateLayouts = map[string]string{
	"date":  isoDate,
	"month": "2006-01",
}

// dateFormat is one way a form may want a date written.
type dateFormat struct {
	key    string
	layout string
	order  string
}

// dateFormats are the ways a form may want today's date. The decision model sees
// each one written out with today's date and picks the one the field shows.
var dateFormats = []dateFormat{
	{"month_day_year_slash", "01/02/2006", "month/day/year"},
	{"day_month_year_slash", "02/01/2006", "day/month/year"},
	{"year_month_day_dash", isoDate, "year-month-day"},
	{"month_day_year_dash", "01-02-2006", "month-day-year"},
	{"day_month_year_dot", "02.01.2006", "day.month.year"},
	{"month_day_short_year_slash", "01/02/06", "month/day/two-digit year"},
	{"month_name_day_year", "January 2, 2006", "month name, day, year"},
	{"day_month_name_year", "2 January 2006", "day, month name, year"},
}

// dateFormatInstructions ask, per date field, how it wants today's date written.
const dateFormatInstructions = "In which format does this job-application field want today's date? Read its " +
	"placeholder, the text under it, and any example it shows. When it shows none, pick the order usual for the " +
	"language and country of the form."

// pageToday is the applicant's local date from the page, else the server's.
func pageToday(page map[string]any) time.Time {
	if raw, ok := page[pageTodayKey].(string); ok {
		if day, err := time.Parse(isoDate, strings.TrimSpace(raw)); err == nil {
			return day
		}
	}
	return time.Now()
}

// dateFormatKinds describe each format by today's date written that way.
func dateFormatKinds(today time.Time) map[string]string {
	kinds := make(map[string]string, len(dateFormats))
	for _, format := range dateFormats {
		kinds[format.key] = fmt.Sprintf("Written %s, like %s.", format.order, today.Format(format.layout))
	}
	return kinds
}

func dateLayout(key string) string {
	for _, format := range dateFormats {
		if format.key == key {
			return format.layout
		}
	}
	return isoDate
}

// todayValues writes today's date for every field that asks for it, each in the
// format that field wants: a native date input in its own layout, any other by
// the decision model's reading of the field.
func (s *Service) todayValues(ctx context.Context, fields []FormField, kinds map[int]string, today time.Time) map[int]string {
	values := map[int]string{}
	ask := map[int]string{}
	for _, field := range fields {
		if kinds[field.ElementIndex] != FactToday {
			continue
		}
		if layout, native := nativeDateLayouts[strings.ToLower(field.InputType)]; native {
			values[field.ElementIndex] = today.Format(layout)
			continue
		}
		ask[field.ElementIndex] = describe(field)
	}
	if len(ask) == 0 {
		return values
	}
	picked, err := s.classifier.ClassifyEach(ctx, dateFormatInstructions, dateFormatKinds(today), ask)
	if err != nil {
		slog.Warn("acorn fast plan: date formats unread, writing year-month-day", "error", err)
	}
	for index := range ask {
		values[index] = today.Format(dateLayout(picked[index]))
	}
	return values
}
