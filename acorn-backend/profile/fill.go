package profile

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/sid0709/OpenSeat/acorn-backend/resume"
	"github.com/sid0709/OpenSeat/backend-core/candidate"
)

// Filled is a profile after a résumé fill, and which reader read the résumé.
type Filled struct {
	Profile Document
	Reader  string
}

// FillText reads résumé text onto current (or the stored profile) and saves.
// The layout parser always runs; a ready model then reads the same text and its
// answers win. A model failure keeps the parser's answers.
func (s *Store) FillText(ctx context.Context, accountID, accountName, accountEmail, text string, current *Document) (Filled, error) {
	base, err := s.base(ctx, accountID, accountName, accountEmail, current)
	if err != nil {
		return Filled{}, err
	}
	next, err := MergeResume(base, text)
	if err != nil {
		return Filled{}, err
	}
	reader := ReaderLayout
	if s.model != nil && s.model.Ready() {
		found, err := readResume(ctx, s.model, text)
		if err != nil {
			slog.Warn("acorn profile: résumé read by layout only", "error", err)
		} else {
			next = normalize(found.apply(next, text))
			reader = ReaderAI
		}
	}
	saved, err := s.Save(ctx, accountID, next)
	if err != nil {
		return Filled{}, fmt.Errorf("save filled profile: %w", err)
	}
	return Filled{Profile: saved, Reader: reader}, nil
}

// FillFile reads a résumé file, merges it, and saves.
func (s *Store) FillFile(ctx context.Context, accountID, accountName, accountEmail, fileName string, data []byte, current *Document) (Filled, error) {
	if len(data) == 0 || len(data) > maxResume {
		return Filled{}, ErrInvalid
	}
	return s.FillText(ctx, accountID, accountName, accountEmail, fileText(fileName, data), current)
}

func (s *Store) base(ctx context.Context, accountID, accountName, accountEmail string, current *Document) (Document, error) {
	if current != nil {
		return *current, nil
	}
	stored, ok, err := s.Load(ctx, accountID)
	if err != nil {
		return Document{}, err
	}
	if ok {
		return stored, nil
	}
	return Blank(accountName, accountEmail), nil
}

// Blank is a profile with only the account name and email filled in.
func Blank(name, email string) Document {
	first, middle, last := splitPerson(name)
	return normalize(Document{
		FullName:   strings.TrimSpace(name),
		FirstName:  first,
		MiddleName: middle,
		LastName:   last,
		Email:      strings.TrimSpace(email),
	})
}

// Candidate is the slice of this profile the planner already knows how to read.
func (d Document) Candidate(accountName, accountEmail string) candidate.Profile {
	name := firstText(d.FullName, accountName)
	email := firstText(d.Email, accountEmail)
	var experience []candidate.ExperienceItem
	var education []candidate.EducationItem
	for _, item := range d.Timeline {
		if item.Kind == "education" {
			education = append(education, candidate.EducationItem{
				ID: item.ID, School: item.Org, Degree: item.Title, Period: period(item), Summary: item.Summary,
				DateRange: dateRange(item),
			})
			continue
		}
		experience = append(experience, candidate.ExperienceItem{
			ID: item.ID, Role: item.Title, Company: item.Org, Period: period(item), Summary: item.Summary,
			DateRange: dateRange(item),
		})
	}
	return candidate.Profile{
		Name: name, Email: email, Phone: d.Phone,
		Location:    joinComma(d.City, d.State),
		HomeAddress: candidate.HomeAddress{Line: d.Street, City: d.City, Region: d.State, PostalCode: d.Zip, Country: d.Country},
		Workplace:   d.WorkModePreference, SalaryFloor: salaryFloor(d.DesiredSalary), Currency: "USD",
		Authorization: d.WorkAuthorized, NoticePeriod: d.NoticePeriod,
		Experience: experience, Education: education,
		Personal: candidate.Personal{
			FirstName: d.FirstName, LastName: d.LastName, Age: ageOf(d.Age),
			Gender: d.Gender, Pronouns: d.Pronouns, Orientation: d.Orientation, Citizenship: d.Citizenship,
		},
		Links: candidate.Links{LinkedIn: d.Linkedin, GitHub: d.Github, Portfolio: d.Portfolio},
		Disclosures: candidate.Disclosures{
			HispanicLatino: d.HispanicLatino, Race: d.RaceEthnicity, Sponsorship: d.VisaSponsorship,
			Disability: d.Disability, Veteran: d.VeteranStatus,
		},
	}
}

// PlannerExtra is form answers the profile type does not carry.
// Passwords and API keys are omitted on purpose.
func (d Document) PlannerExtra() map[string]string {
	return map[string]string{
		"middleName":        d.MiddleName,
		"workAuthorized":    d.WorkAuthorized,
		"publicTrust":       d.PublicTrust,
		"securityClearance": d.SecurityClearance,
		"over18":            d.Over18,
		"backgroundCheck":   d.BackgroundCheck,
		"willingToRelocate": d.WillingToRelocate,
		"willingToTravel":   d.WillingToTravel,
	}
}

// ResumeIdentity is the person a generated résumé is written for.
func (d Document) ResumeIdentity() resume.Identity {
	out := resume.Identity{
		FullName: d.FullName, Location: joinComma(d.City, d.State),
		Email: d.Email, Phone: d.Phone, Linkedin: d.Linkedin,
	}
	for _, item := range d.Timeline {
		if item.Kind == "education" {
			out.Education = append(out.Education, resume.EducationEntry{School: item.Org, Degree: item.Title, Period: period(item)})
			continue
		}
		out.Careers = append(out.Careers, resume.CareerEntry{Company: item.Org, Title: item.Title, Period: period(item), Description: item.Summary})
	}
	return out
}

func period(item Entry) string {
	start := joinSlash(item.StartMonth, item.StartYear)
	end := joinSlash(item.EndMonth, item.EndYear)
	if item.Current {
		end = "Present"
	}
	return joinDash(start, end)
}

func dateRange(item Entry) candidate.DateRange {
	return candidate.DateRange{
		StartMonth: atoi(item.StartMonth), StartYear: atoi(item.StartYear),
		EndMonth: atoi(item.EndMonth), EndYear: atoi(item.EndYear), Current: item.Current,
	}
}

func salaryFloor(value string) int {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, value)
	return atoi(digits)
}

func ageOf(value string) int { return atoi(strings.TrimSpace(value)) }

func atoi(value string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(value))
	return n
}

func firstText(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func joinComma(left, right string) string {
	return join(left, right, ", ")
}

func joinSlash(left, right string) string {
	return join(left, right, "/")
}

func joinDash(left, right string) string {
	return join(left, right, " – ")
}

func join(left, right, sep string) string {
	left, right = strings.TrimSpace(left), strings.TrimSpace(right)
	switch {
	case left == "":
		return right
	case right == "":
		return left
	default:
		return left + sep + right
	}
}
