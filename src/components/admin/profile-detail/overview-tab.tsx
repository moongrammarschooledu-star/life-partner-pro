import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatEnumLabel, formatHeight } from "@/lib/utils";
import type { ProfileDetailDto } from "@/lib/serializers";

function Row({ label, value }: { label: string; value?: string | number | null | boolean }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-border last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-right">{typeof value === "boolean" ? (value ? "Yes" : "No") : value}</span>
    </div>
  );
}

export function OverviewTab({ profile }: { profile: ProfileDetailDto }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic Information</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Full Name" value={profile.fullName} />
          <Row label="Gender" value={formatEnumLabel(profile.gender)} />
          <Row label="Age" value={profile.age} />
          <Row label="Marital Status" value={formatEnumLabel(profile.maritalStatus)} />
          <Row label="Has Children" value={profile.hasChildren} />
          <Row label="Number of Children" value={profile.numberOfChildren} />
          <Row label="Height" value={formatHeight(profile.heightCm)} />
          <Row label="City" value={[profile.area, profile.city].filter(Boolean).join(", ")} />
          <Row label="Country" value={profile.country} />
          <Row label="Nationality" value={profile.nationality} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Education & Profession</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Education Level" value={profile.education?.level} />
          <Row label="Degree" value={profile.education?.degree} />
          <Row label="Institution" value={profile.education?.institution} />
          <Row label="Profession" value={profile.profession?.profession} />
          <Row label="Job Title" value={profile.profession?.jobTitle} />
          <Row label="Company" value={profile.profession?.companyName} />
          <Row label="Employment Type" value={profile.profession?.employmentType ? formatEnumLabel(profile.profession.employmentType) : undefined} />
          <Row label="Monthly Income" value={formatCurrency(profile.profession?.monthlyIncome)} />
          <Row label="Work Location" value={profile.profession?.workLocation} />
          <Row label="Program" value={profile.profession?.program} />
          <Row label="Expected Graduation" value={profile.profession?.expectedGraduation} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Family Information</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Father's Occupation" value={profile.family?.fatherOccupation} />
          <Row label="Mother's Occupation" value={profile.family?.motherOccupation} />
          <Row label="Brothers" value={profile.family?.numberOfBrothers} />
          <Row label="Sisters" value={profile.family?.numberOfSisters} />
          <Row label="Family Type" value={profile.family?.familyType ? formatEnumLabel(profile.family.familyType) : undefined} />
          <Row label="Family Status" value={profile.family?.familyStatus ? formatEnumLabel(profile.family.familyStatus) : undefined} />
          <Row label="Family Location" value={profile.family?.familyLocation} />
          <Row label="Background" value={profile.family?.familyBackground} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifestyle</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Religion" value={profile.lifestyle?.religion} />
          <Row label="Sect" value={profile.lifestyle?.sect} />
          <Row label="Religious Practice" value={profile.lifestyle?.religiousPractice} />
          <Row label="Languages" value={profile.lifestyle?.languages} />
          <Row label="Smoking" value={profile.lifestyle?.smoking} />
          <Row label="Drinking" value={profile.lifestyle?.drinking} />
          <Row label="Hobbies" value={profile.lifestyle?.hobbies} />
          <Row label="Personality" value={profile.lifestyle?.personality} />
          {profile.lifestyle?.aboutMe && (
            <div className="pt-2">
              <p className="text-xs uppercase tracking-wide text-muted mb-1">About Me</p>
              <p className="text-sm">{profile.lifestyle.aboutMe}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Partner Requirements</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 sm:grid-cols-2">
          <div>
            <Row label="Age Range" value={profile.preference?.minAge || profile.preference?.maxAge ? `${profile.preference?.minAge ?? "?"} - ${profile.preference?.maxAge ?? "?"}` : undefined} />
            <Row label="Age Priority" value={profile.preference?.agePriority ? formatEnumLabel(profile.preference.agePriority) : undefined} />
            <Row label="Preferred Location" value={[profile.preference?.preferredCity, profile.preference?.preferredCountry].filter(Boolean).join(", ")} />
            <Row label="Location Scope" value={profile.preference?.locationScope} />
            <Row label="Location Priority" value={profile.preference?.locationPriority ? formatEnumLabel(profile.preference.locationPriority) : undefined} />
            <Row label="Min Education" value={profile.preference?.minEducation} />
            <Row label="Profession Preference" value={profile.preference?.professionPreference} />
            <Row label="Profession Priority" value={profile.preference?.professionPriority ? formatEnumLabel(profile.preference.professionPriority) : undefined} />
          </div>
          <div>
            <Row
              label="Income Preference"
              value={profile.preference?.incomeFlexible ? "Flexible" : `${formatCurrency(profile.preference?.minIncome)} - ${formatCurrency(profile.preference?.maxIncome)}`}
            />
            <Row label="Marital Status Preference" value={profile.preference?.maritalStatusPreference} />
            <Row
              label="Height Range"
              value={profile.preference?.minHeightCm || profile.preference?.maxHeightCm ? `${profile.preference?.minHeightCm ?? "?"} - ${profile.preference?.maxHeightCm ?? "?"} cm` : undefined}
            />
            <Row label="Family Preference" value={profile.preference?.familyTypePreference} />
          </div>
          {profile.preference?.additionalExpectations && (
            <div className="sm:col-span-2 pt-2">
              <p className="text-xs uppercase tracking-wide text-muted mb-1">Additional Expectations</p>
              <p className="text-sm">{profile.preference.additionalExpectations}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
