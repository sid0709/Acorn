// Package profile stores the account profile the website edits and Fill reads.
package profile

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const profilesCollection = "acorn_profiles"

const (
	maxName    = 120
	maxContact = 200
	maxSecret  = 200
	// maxSummary fits a role's full set of résumé bullets.
	maxSummary     = 4000
	maxTimeline    = 24
	maxResume      = 8 << 20
	minResumeRunes = 40

	defaultGender      = "Male"
	defaultOrientation = "Heterosexual"

	// Answers a new profile starts with; an empty answer is filled with these on save.
	defaultPublicTrust     = "None"
	defaultClearance       = "None"
	defaultRelocate        = "Yes"
	defaultWorkMode        = "Remote"
	defaultTravel          = "None"
	defaultNoticePeriod    = "Immediately"
	defaultHispanicLatino  = "No"
	defaultRaceEthnicity   = "White"
	defaultCitizenship     = "U.S. Citizen"
	defaultVisaSponsorship = "No — no sponsorship"
	defaultOver18          = "Yes"
	defaultBackgroundCheck = "Yes"
	defaultDisability      = "No — no disability"
	defaultVeteranStatus   = "I am not a protected veteran"
)

var (
	// ErrInvalid is a profile or résumé Acorn will not store.
	ErrInvalid = errors.New("invalid profile")
	// ErrUnreadable is a résumé file with no usable text.
	ErrUnreadable = errors.New("couldn't read text from that file")
)

// Entry is one role or school on the profile timeline.
type Entry struct {
	ID         string `json:"id" bson:"id"`
	Kind       string `json:"kind" bson:"kind"`
	Title      string `json:"title" bson:"title"`
	Org        string `json:"org" bson:"org"`
	Location   string `json:"location" bson:"location"`
	Summary    string `json:"summary" bson:"summary"`
	StartMonth string `json:"startMonth" bson:"startMonth"`
	StartYear  string `json:"startYear" bson:"startYear"`
	EndMonth   string `json:"endMonth" bson:"endMonth"`
	EndYear    string `json:"endYear" bson:"endYear"`
	Current    bool   `json:"current" bson:"current"`
}

// Document is the profile form. Passwords and API keys stay here for the
// signed-in account and are never copied into the planner prompt.
type Document struct {
	FullName               string  `json:"fullName" bson:"fullName"`
	FirstName              string  `json:"firstName" bson:"firstName"`
	MiddleName             string  `json:"middleName" bson:"middleName"`
	LastName               string  `json:"lastName" bson:"lastName"`
	Headline               string  `json:"headline" bson:"headline"`
	Age                    string  `json:"age" bson:"age"`
	Gender                 string  `json:"gender" bson:"gender"`
	Pronouns               string  `json:"pronouns" bson:"pronouns"`
	Orientation            string  `json:"orientation" bson:"orientation"`
	Email                  string  `json:"email" bson:"email"`
	Phone                  string  `json:"phone" bson:"phone"`
	Street                 string  `json:"street" bson:"street"`
	City                   string  `json:"city" bson:"city"`
	State                  string  `json:"state" bson:"state"`
	Citizenship            string  `json:"citizenship" bson:"citizenship"`
	Country                string  `json:"country" bson:"country"`
	Zip                    string  `json:"zip" bson:"zip"`
	Linkedin               string  `json:"linkedin" bson:"linkedin"`
	Github                 string  `json:"github" bson:"github"`
	Portfolio              string  `json:"portfolio" bson:"portfolio"`
	HispanicLatino         string  `json:"hispanicLatino" bson:"hispanicLatino"`
	RaceEthnicity          string  `json:"raceEthnicity" bson:"raceEthnicity"`
	VisaSponsorship        string  `json:"visaSponsorship" bson:"visaSponsorship"`
	WorkAuthorized         string  `json:"workAuthorized" bson:"workAuthorized"`
	PublicTrust            string  `json:"publicTrust" bson:"publicTrust"`
	SecurityClearance      string  `json:"securityClearance" bson:"securityClearance"`
	Over18                 string  `json:"over18" bson:"over18"`
	BackgroundCheck        string  `json:"backgroundCheck" bson:"backgroundCheck"`
	WillingToRelocate      string  `json:"willingToRelocate" bson:"willingToRelocate"`
	WorkModePreference     string  `json:"workModePreference" bson:"workModePreference"`
	WillingToTravel        string  `json:"willingToTravel" bson:"willingToTravel"`
	NoticePeriod           string  `json:"noticePeriod" bson:"noticePeriod"`
	Disability             string  `json:"disability" bson:"disability"`
	VeteranStatus          string  `json:"veteranStatus" bson:"veteranStatus"`
	DesiredSalary          string  `json:"desiredSalary" bson:"desiredSalary"`
	OpenrouterApiKey       string  `json:"openrouterApiKey" bson:"openrouterApiKey"`
	DefaultAccountPassword string  `json:"defaultAccountPassword" bson:"defaultAccountPassword"`
	ExtensionPassword      string  `json:"extensionPassword" bson:"extensionPassword"`
	ResumeFolderPath       string  `json:"resumeFolderPath" bson:"resumeFolderPath"`
	Timeline               []Entry `json:"timeline" bson:"timeline"`
}

type storedProfile struct {
	AccountID string    `bson:"accountId"`
	Profile   Document  `bson:"profile"`
	UpdatedAt time.Time `bson:"updatedAt"`
}

// Store keeps one profile per account. Memory is the copy this process reads;
// Mongo is filled when a client is configured. A ready model, or the profile's
// OpenRouter key, reads uploaded résumés; without either, the layout parser does.
type Store struct {
	mu    sync.Mutex
	rows  map[string]Document
	coll  *mongo.Collection
	model Model
}

func NewMemory() *Store {
	return &Store{rows: map[string]Document{}}
}

func NewStore(client *mongo.Client, database string, model Model) *Store {
	store := NewMemory()
	store.model = model
	if client != nil && database != "" {
		store.coll = client.Database(database).Collection(profilesCollection)
	}
	return store
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	if s.coll == nil {
		return nil
	}
	_, err := s.coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "accountId", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	return err
}

// Delete removes the saved profile for this account.
func (s *Store) Delete(ctx context.Context, accountID string) error {
	s.mu.Lock()
	delete(s.rows, accountID)
	s.mu.Unlock()
	if s.coll == nil {
		return nil
	}
	_, err := s.coll.DeleteOne(ctx, bson.D{{Key: "accountId", Value: accountID}})
	if err != nil {
		return fmt.Errorf("delete profile: %w", err)
	}
	return nil
}

// AccountIDByProfileEmail finds the account whose profile contact email matches.
func (s *Store) AccountIDByProfileEmail(ctx context.Context, email string) (string, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return "", false, nil
	}
	if s.coll == nil {
		s.mu.Lock()
		for id, doc := range s.rows {
			if strings.ToLower(strings.TrimSpace(doc.Email)) == email {
				s.mu.Unlock()
				return id, true, nil
			}
		}
		s.mu.Unlock()
		return "", false, nil
	}
	filter := bson.D{{Key: "$expr", Value: bson.D{
		{Key: "$eq", Value: bson.A{
			bson.D{{Key: "$toLower", Value: bson.D{{Key: "$trim", Value: bson.M{"input": "$profile.email"}}}}},
			email,
		}},
	}}}
	var row storedProfile
	err := s.coll.FindOne(ctx, filter).Decode(&row)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	doc := normalize(row.Profile)
	s.mu.Lock()
	s.rows[row.AccountID] = doc
	s.mu.Unlock()
	return row.AccountID, true, nil
}

func (s *Store) Load(ctx context.Context, accountID string) (Document, bool, error) {
	// With Mongo configured, the collection is the account profile. Memory is only
	// a cache of that read, so a support-session save is what the user loads next.
	if s.coll == nil {
		s.mu.Lock()
		doc, ok := s.rows[accountID]
		s.mu.Unlock()
		if !ok {
			return Document{}, false, nil
		}
		return normalize(doc), true, nil
	}
	var row storedProfile
	err := s.coll.FindOne(ctx, bson.D{{Key: "accountId", Value: accountID}}).Decode(&row)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Document{}, false, nil
	}
	if err != nil {
		return Document{}, false, err
	}
	doc := normalize(row.Profile)
	s.mu.Lock()
	s.rows[accountID] = doc
	s.mu.Unlock()
	return doc, true, nil
}

// Save replaces the account profile.
func (s *Store) Save(ctx context.Context, accountID string, doc Document) (Document, error) {
	doc = normalize(doc)
	if s.coll != nil {
		_, err := s.coll.UpdateOne(ctx,
			bson.D{{Key: "accountId", Value: accountID}},
			bson.D{{Key: "$set", Value: bson.D{
				{Key: "accountId", Value: accountID},
				{Key: "profile", Value: doc},
				{Key: "updatedAt", Value: time.Now().UTC()},
			}}},
			options.UpdateOne().SetUpsert(true),
		)
		if err != nil {
			return Document{}, err
		}
	}
	s.mu.Lock()
	s.rows[accountID] = doc
	s.mu.Unlock()
	return doc, nil
}

func normalize(doc Document) Document {
	doc.FullName = clip(doc.FullName, maxName)
	doc.FirstName = clip(doc.FirstName, maxName)
	doc.MiddleName = clip(doc.MiddleName, maxName)
	doc.LastName = clip(doc.LastName, maxName)
	doc.Headline = clip(doc.Headline, maxName)
	doc.Age = clip(doc.Age, 3)
	doc.Gender = clip(doc.Gender, maxContact)
	if doc.Gender == "" {
		doc.Gender = defaultGender
	}
	doc.Pronouns = clip(doc.Pronouns, maxContact)
	doc.Orientation = clip(doc.Orientation, maxContact)
	if doc.Orientation == "" {
		doc.Orientation = defaultOrientation
	}
	doc.Email = clip(doc.Email, maxContact)
	doc.Phone = clip(doc.Phone, maxContact)
	doc.Street = clip(doc.Street, maxContact)
	doc.City = clip(doc.City, maxContact)
	doc.State = clip(doc.State, maxContact)
	doc.Citizenship = orDefault(clip(doc.Citizenship, maxContact), defaultCitizenship)
	doc.Country = clip(doc.Country, maxContact)
	doc.Zip = clip(doc.Zip, maxContact)
	doc.Linkedin = clip(doc.Linkedin, maxContact)
	doc.Github = clip(doc.Github, maxContact)
	doc.Portfolio = clip(doc.Portfolio, maxContact)
	doc.HispanicLatino = orDefault(clip(doc.HispanicLatino, maxContact), defaultHispanicLatino)
	doc.RaceEthnicity = orDefault(clip(doc.RaceEthnicity, maxContact), defaultRaceEthnicity)
	doc.VisaSponsorship = orDefault(clip(doc.VisaSponsorship, maxContact), defaultVisaSponsorship)
	doc.WorkAuthorized = clip(doc.WorkAuthorized, maxContact)
	doc.PublicTrust = orDefault(clip(doc.PublicTrust, maxContact), defaultPublicTrust)
	doc.SecurityClearance = orDefault(clip(doc.SecurityClearance, maxContact), defaultClearance)
	doc.Over18 = orDefault(clip(doc.Over18, maxContact), defaultOver18)
	doc.BackgroundCheck = orDefault(clip(doc.BackgroundCheck, maxContact), defaultBackgroundCheck)
	doc.WillingToRelocate = orDefault(clip(doc.WillingToRelocate, maxContact), defaultRelocate)
	doc.WorkModePreference = orDefault(clip(doc.WorkModePreference, maxContact), defaultWorkMode)
	doc.WillingToTravel = orDefault(clip(doc.WillingToTravel, maxContact), defaultTravel)
	doc.NoticePeriod = orDefault(clip(doc.NoticePeriod, maxContact), defaultNoticePeriod)
	doc.Disability = orDefault(clip(doc.Disability, maxContact), defaultDisability)
	doc.VeteranStatus = orDefault(clip(doc.VeteranStatus, maxContact), defaultVeteranStatus)
	doc.DesiredSalary = clip(doc.DesiredSalary, maxContact)
	doc.OpenrouterApiKey = clip(doc.OpenrouterApiKey, maxSecret)
	doc.DefaultAccountPassword = clip(doc.DefaultAccountPassword, maxSecret)
	doc.ExtensionPassword = clip(doc.ExtensionPassword, maxSecret)
	doc.ResumeFolderPath = clip(doc.ResumeFolderPath, maxContact)
	if len(doc.Timeline) > maxTimeline {
		doc.Timeline = doc.Timeline[:maxTimeline]
	}
	if doc.Timeline == nil {
		doc.Timeline = []Entry{}
	}
	for i := range doc.Timeline {
		item := &doc.Timeline[i]
		item.ID = clip(item.ID, maxName)
		if item.Kind != "education" {
			item.Kind = "role"
		}
		item.Title = clip(item.Title, maxName)
		item.Org = clip(item.Org, maxName)
		item.Location = clip(item.Location, maxContact)
		item.Summary = clip(item.Summary, maxSummary)
		item.StartMonth = clip(item.StartMonth, 2)
		item.StartYear = clip(item.StartYear, 4)
		item.EndMonth = clip(item.EndMonth, 2)
		item.EndYear = clip(item.EndYear, 4)
		if item.Current {
			item.EndMonth = ""
			item.EndYear = ""
		}
	}
	return doc
}

// clip trims value to at most max bytes without splitting a character.
func clip(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return strings.TrimSpace(value[:cut])
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
