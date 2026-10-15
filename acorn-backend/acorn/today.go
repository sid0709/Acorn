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
	// A date of a job or a school is often asked as a month and a year only.
	{"month_year_slash", "01/2006", "month/year"},
	{"month_year_dash", "2006-01", "year-month"},
	{"month_name_year", "January 2006", "month name, year"},
	{"month_short_name_year", "Jan 2006", "abbreviated month name, year"},
	{"year_only", "2006", "year only"},
}

// dateFormatInstructions ask, per date field, how it wants a date written.
const dateFormatInstructions = "In which format does this job-application field want the date? Read its " +
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

// dateFormatKinds describe each format by a date written that way.
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

// dateFacts are the facts whose value is a date from the applicant's history: they are
// written the way each field wants, like today's date.
var dateFacts = map[string]bool{
	"job_start_date": true, "job_end_date": true, "school_start_date": true, "school_end_date": true,
}

// isDateKind says a field's fact is a date to write in the field's own format.
func isDateKind(kind string) bool { return kind == FactToday || dateFacts[kind] }

// profileDateLayouts are the ways a profile may have stored a date, most exact first.
var profileDateLayouts = []string{
	"2006-01-02", "2006-01", "01/02/2006", "1/2/2006", "01/2006", "1/2006",
	"January 2, 2006", "Jan 2, 2006", "January 2006", "Jan 2006", "2006",
}

// parseProfileDate reads a stored date; a month without a day is its first.
func parseProfileDate(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	for _, layout := range profileDateLayouts {
		if day, err := time.Parse(layout, raw); err == nil {
			return day, true
		}
	}
	return time.Time{}, false
}

// dateOf is the date a date field is to hold: today's for a signature date, the profile's
// for a date of a job or a school. False when the profile holds none that can be read.
func dateOf(profile applicantFacts, kind string) (time.Time, bool) {
	if kind == FactToday {
		return profile.today, !profile.today.IsZero()
	}
	return parseProfileDate(factValue(profile, kind))
}

// dateValues writes the date of every date field in the format that field wants: a native
// date input in its own layout, any other by the decision model's reading of the field
// (its placeholder, the text under it). Fields wanting the same date are asked together.
func (s *Service) dateValues(ctx context.Context, fields []FormField, kinds map[int]string, profile applicantFacts) map[int]string {
	values := map[int]string{}
	asked := map[string]map[int]string{}
	dates := map[string]time.Time{}
	for _, field := range fields {
		kind := kinds[field.ElementIndex]
		if !isDateKind(kind) {
			continue
		}
		date, ok := dateOf(profile, kind)
		if !ok {
			continue
		}
		if layout, native := nativeDateLayouts[strings.ToLower(field.InputType)]; native {
			values[field.ElementIndex] = date.Format(layout)
			continue
		}
		key := date.Format(isoDate)
		if asked[key] == nil {
			asked[key] = map[int]string{}
			dates[key] = date
		}
		asked[key][field.ElementIndex] = describe(field)
	}
	for key, ask := range asked {
		date := dates[key]
		picked, err := s.classifier.ClassifyEach(ctx, dateFormatInstructions, dateFormatKinds(date), ask)
		if err != nil {
			slog.Warn("acorn fast plan: date formats unread, writing year-month-day", "error", err)
		}
		for index := range ask {
			values[index] = date.Format(dateLayout(picked[index]))
		}
	}
	return values
}
