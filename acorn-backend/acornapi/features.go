package acornapi

// Features name what a model call was for, so usage stats group by product
// feature instead of by URL. Every route that calls a model has one here; a
// route missing from routeFeatures is recorded under its pattern.
const (
	featureAsk                 = "ask"
	featureResumeGenerate      = "resume_generate"
	featureResumeAnalyze       = "resume_analyze"
	featureRecommend           = "recommend"
	featureProfileImport       = "profile_import"
	featureGmailLabel          = "gmail_label"
	featureRunMailVerification = "run_mail_verification"
)

var routeFeatures = map[string]string{
	"POST /acorn/qa":                                 featureAsk,
	"POST /acorn/custom/generate":                    featureResumeGenerate,
	"POST /acorn/custom/generate/{inputId}/continue": featureResumeGenerate,
	"POST /acorn/resume/generate":                    featureResumeGenerate,
	"POST /acorn/resume/generate/{inputId}/continue": featureResumeGenerate,
	"POST /acorn/jobs/{jobId}/generate":              featureResumeGenerate,
	"POST /acorn/resume/library/{resumeId}/analyze":  featureResumeAnalyze,
	"POST /acorn/custom/recommend":                   featureRecommend,
	"POST /acorn/profile/from-resume":                featureProfileImport,
	"POST /acorn/gmail/autolabel":                    featureGmailLabel,
	"POST /acorn/run/mail-verification":              featureRunMailVerification,
}

// featureForRoute is the feature a route pattern belongs to, or the pattern itself.
func featureForRoute(pattern string) string {
	if feature, ok := routeFeatures[pattern]; ok {
		return feature
	}
	return pattern
}
