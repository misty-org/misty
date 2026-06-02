package api

import "github.com/kannachi323/misty/server/db"

func licenseAllowsUse(license *db.License) bool {
	if license == nil {
		return false
	}

	return license.Status == db.LicenseStatusActive || license.Status == db.LicenseStatusTrialing
}
