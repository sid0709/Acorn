// Package candidate holds the applicant profile the agent fills application forms from.
package candidate

type HomeAddress struct {
	Line       string `json:"line" bson:"line"`
	City       string `json:"city" bson:"city"`
	Region     string `json:"region" bson:"region"`
	PostalCode string `json:"postalCode" bson:"postalCode"`
	Country    string `json:"country" bson:"country"`
}

// DateRange is when a role or a school ran. Zero months and years are unset;
// Current means it has not ended, so the end is ignored.
type DateRange struct {
	StartMonth int  `json:"startMonth" bson:"startMonth"`
	StartYear  int  `json:"startYear" bson:"startYear"`
	EndMonth   int  `json:"endMonth" bson:"endMonth"`
	EndYear    int  `json:"endYear" bson:"endYear"`
	Current    bool `json:"current,omitempty" bson:"current,omitempty"`
}

// ExperienceItem is one role. Period is derived from the dates when they are set;
// older entries carry only the free-text Period.
type ExperienceItem struct {
	ID        string `json:"id" bson:"id"`
	Role      string `json:"role" bson:"role"`
	Company   string `json:"company" bson:"company"`
	Period    string `json:"period" bson:"period"`
	Summary   string `json:"summary" bson:"summary"`
	DateRange `bson:",inline"`
}

// EducationItem is one school, degree, or program.
type EducationItem struct {
	ID        string `json:"id" bson:"id"`
	School    string `json:"school" bson:"school"`
	Degree    string `json:"degree" bson:"degree"`
	Field     string `json:"field" bson:"field"`
	Period    string `json:"period" bson:"period"`
	Summary   string `json:"summary" bson:"summary"`
	DateRange `bson:",inline"`
}

// Personal is who the job hunter is, for application forms. Only the job hunter
// and Acorn read it; companies never see it.
type Personal struct {
	FirstName   string `json:"firstName" bson:"firstName"`
	LastName    string `json:"lastName" bson:"lastName"`
	Age         int    `json:"age" bson:"age"`
	Gender      string `json:"gender" bson:"gender"`
	Pronouns    string `json:"pronouns" bson:"pronouns"`
	Orientation string `json:"orientation" bson:"orientation"`
	Citizenship string `json:"citizenship" bson:"citizenship"`
}

// Links are the job hunter's public profiles.
type Links struct {
	LinkedIn  string `json:"linkedin" bson:"linkedin"`
	GitHub    string `json:"github" bson:"github"`
	Portfolio string `json:"portfolio" bson:"portfolio"`
}

// Disclosures are voluntary self-identification (EEO) and sponsorship answers.
// Acorn uses them to answer those questions; companies never see them.
type Disclosures struct {
	HispanicLatino string `json:"hispanicLatino" bson:"hispanicLatino"`
	Race           string `json:"race" bson:"race"`
	Sponsorship    string `json:"sponsorship" bson:"sponsorship"`
	Disability     string `json:"disability" bson:"disability"`
	Veteran        string `json:"veteran" bson:"veteran"`
}

type Visibility struct {
	OpenToWork       bool `json:"openToWork" bson:"openToWork"`
	RecruiterSearch  bool `json:"recruiterSearch" bson:"recruiterSearch"`
	HideFromEmployer bool `json:"hideFromEmployer" bson:"hideFromEmployer"`
}

type Status struct {
	Label   string `json:"label" bson:"label"`
	Variant string `json:"variant" bson:"variant"`
}

type Profile struct {
	Name          string           `json:"name"`
	Email         string           `json:"email"`
	Phone         string           `json:"phone" bson:"phone"`
	Headline      string           `json:"headline" bson:"headline"`
	Location      string           `json:"location" bson:"location"`
	HomeAddress   HomeAddress      `json:"homeAddress" bson:"homeAddress"`
	About         string           `json:"about" bson:"about"`
	MemberSince   string           `json:"memberSince" bson:"-"`
	Status        Status           `json:"status" bson:"status"`
	TargetRoles   []string         `json:"targetRoles" bson:"targetRoles"`
	Locations     []string         `json:"locations" bson:"locations"`
	Workplace     string           `json:"workplace" bson:"workplace"`
	SalaryFloor   int              `json:"salaryFloor" bson:"salaryFloor"`
	Currency      string           `json:"currency" bson:"currency"`
	Authorization string           `json:"authorization" bson:"authorization"`
	NoticePeriod  string           `json:"noticePeriod" bson:"noticePeriod"`
	Skills        []string         `json:"skills" bson:"skills"`
	Experience    []ExperienceItem `json:"experience" bson:"experience"`
	Education     []EducationItem  `json:"education" bson:"education"`
	Personal      Personal         `json:"personal" bson:"personal"`
	Links         Links            `json:"links" bson:"links"`
	Disclosures   Disclosures      `json:"disclosures" bson:"disclosures"`
	Visibility    Visibility       `json:"visibility" bson:"visibility"`
}
