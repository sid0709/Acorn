package jobs

import (
	"context"
	"errors"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// listingActive is the listing status of a job people can see. A job saved before listings had a
// status has none, and is also public.
const listingActive = "active"

// Job is the part of a posting the agent works from.
type Job struct {
	ID          string
	Title       string
	Company     string
	CompanyLogo string
	Location    string
	Workplace   string
	ApplyLink   string
	Description string
}

type storedJob struct {
	ID            bson.ObjectID `bson:"_id"`
	ApplyLink     string        `bson:"applyLink"`
	ListingStatus string        `bson:"listingStatus"`
	Job           struct {
		ID          string `bson:"id"`
		Title       string `bson:"title"`
		Company     string `bson:"company"`
		CompanyID   string `bson:"companyId"`
		Location    string `bson:"location"`
		Workplace   string `bson:"workplace"`
		Description string `bson:"description"`
	} `bson:"job"`
}

type storedCompany struct {
	CompanyLogo string `bson:"companyLogo"`
	Overrides   struct {
		Logo *string `bson:"logo"`
	} `bson:"overrides"`
}

// logo is the company's logo link; a link an editor set replaces the one the crawler found.
func (c storedCompany) logo() string {
	if c.Overrides.Logo != nil {
		return strings.TrimSpace(*c.Overrides.Logo)
	}
	return strings.TrimSpace(c.CompanyLogo)
}

// GetCatalogJob finds a public job by its document id or its public id.
func (s *Store) GetCatalogJob(ctx context.Context, id string) (Job, error) {
	filter := bson.D{{Key: "job.id", Value: id}}
	if objectID, err := bson.ObjectIDFromHex(id); err == nil {
		filter = bson.D{{Key: "_id", Value: objectID}}
	}
	var doc storedJob
	err := s.jobs().FindOne(ctx, filter).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Job{}, ErrNotFound
	}
	if err != nil {
		return Job{}, err
	}
	if doc.ListingStatus != "" && doc.ListingStatus != listingActive {
		return Job{}, ErrNotFound
	}
	job := Job{
		ID:          doc.Job.ID,
		Title:       doc.Job.Title,
		Company:     doc.Job.Company,
		Location:    doc.Job.Location,
		Workplace:   doc.Job.Workplace,
		ApplyLink:   doc.ApplyLink,
		Description: doc.Job.Description,
	}
	if doc.Job.CompanyID == "" {
		return job, nil
	}
	var company storedCompany
	err = s.companies().FindOne(ctx, bson.D{{Key: "id", Value: doc.Job.CompanyID}}, options.FindOne().SetProjection(bson.D{
		{Key: "companyLogo", Value: 1},
		{Key: "overrides.logo", Value: 1},
	})).Decode(&company)
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return Job{}, err
	}
	if err == nil {
		job.CompanyLogo = company.logo()
	}
	return job, nil
}
