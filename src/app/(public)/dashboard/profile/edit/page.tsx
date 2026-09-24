"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// STEP 21 — sensitive-field edit form. Identity/eligibility-bearing fields
// (Decision 2) go through the EXISTING admin-reviewed pipeline
// (POST /api/update-request, PendingUpdate model) rather than a new review
// queue — this page only widens the UI to the field groups that route
// already accepted (previously only 3 fields were exposed anywhere).
export default function EditProfilePage() {
  const { show } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [personal, setPersonal] = useState({ fullName: "", city: "", area: "", country: "", maritalStatus: "", heightCm: "" });
  const [contact, setContact] = useState({ mobileNumber: "", whatsappNumber: "" });
  const [education, setEducation] = useState({ level: "", degree: "", institution: "" });
  const [profession, setProfession] = useState({ profession: "", jobTitle: "", companyName: "" });
  const [family, setFamily] = useState({ fatherOccupation: "", motherOccupation: "", familyBackground: "" });

  useEffect(() => {
    fetch("/api/my-profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setPersonal({
          fullName: data.personal?.fullName ?? "",
          city: data.personal?.city ?? "",
          area: data.personal?.area ?? "",
          country: data.personal?.country ?? "",
          maritalStatus: data.personal?.maritalStatus ?? "",
          heightCm: data.personal?.heightCm != null ? String(data.personal.heightCm) : "",
        });
        setContact({ mobileNumber: data.contact?.mobileNumber ?? "", whatsappNumber: data.contact?.whatsappNumber ?? "" });
        setEducation({ level: data.education?.level ?? "", degree: data.education?.degree ?? "", institution: data.education?.institution ?? "" });
        setProfession({ profession: data.profession?.profession ?? "", jobTitle: data.profession?.jobTitle ?? "", companyName: data.profession?.companyName ?? "" });
        setFamily({ fatherOccupation: data.family?.fatherOccupation ?? "", motherOccupation: data.family?.motherOccupation ?? "", familyBackground: data.family?.familyBackground ?? "" });
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/update-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", personal, contact, education, profession, family }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not submit your changes.", "error");
        return;
      }
      show("Your changes have been submitted for admin review.", "success");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Edit Profile</h1>
        <p className="mt-1 text-sm text-muted">
          These fields affect your identity or eligibility, so changes go through admin review before taking effect. See your{" "}
          <Link href="/dashboard/profile" className="text-primary hover:underline">pending request status</Link> after submitting.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Full Name" htmlFor="fullName"><Input id="fullName" value={personal.fullName} onChange={(e) => setPersonal({ ...personal, fullName: e.target.value })} /></Field>
          <Field label="Marital Status" htmlFor="maritalStatus">
            <Select id="maritalStatus" value={personal.maritalStatus} onChange={(e) => setPersonal({ ...personal, maritalStatus: e.target.value })}>
              <option value="">Select...</option>
              {["NEVER_MARRIED", "DIVORCED", "WIDOWED", "ANNULLED"].map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
            </Select>
          </Field>
          <Field label="City" htmlFor="city"><Input id="city" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} /></Field>
          <Field label="Area" htmlFor="area"><Input id="area" value={personal.area} onChange={(e) => setPersonal({ ...personal, area: e.target.value })} /></Field>
          <Field label="Country" htmlFor="country"><Input id="country" value={personal.country} onChange={(e) => setPersonal({ ...personal, country: e.target.value })} /></Field>
          <Field label="Height (cm)" htmlFor="heightCm"><Input id="heightCm" type="number" value={personal.heightCm} onChange={(e) => setPersonal({ ...personal, heightCm: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile Number" htmlFor="mobileNumber"><Input id="mobileNumber" value={contact.mobileNumber} onChange={(e) => setContact({ ...contact, mobileNumber: e.target.value })} /></Field>
          <Field label="WhatsApp Number" htmlFor="whatsappNumber"><Input id="whatsappNumber" value={contact.whatsappNumber} onChange={(e) => setContact({ ...contact, whatsappNumber: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Education</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Education Level" htmlFor="level"><Input id="level" value={education.level} onChange={(e) => setEducation({ ...education, level: e.target.value })} /></Field>
          <Field label="Degree" htmlFor="degree"><Input id="degree" value={education.degree} onChange={(e) => setEducation({ ...education, degree: e.target.value })} /></Field>
          <Field label="Institution" htmlFor="institution"><Input id="institution" value={education.institution} onChange={(e) => setEducation({ ...education, institution: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Career</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Profession" htmlFor="profession"><Input id="profession" value={profession.profession} onChange={(e) => setProfession({ ...profession, profession: e.target.value })} /></Field>
          <Field label="Job Title" htmlFor="jobTitle"><Input id="jobTitle" value={profession.jobTitle} onChange={(e) => setProfession({ ...profession, jobTitle: e.target.value })} /></Field>
          <Field label="Company Name" htmlFor="companyName"><Input id="companyName" value={profession.companyName} onChange={(e) => setProfession({ ...profession, companyName: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Family</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Father's Occupation" htmlFor="fatherOccupation"><Input id="fatherOccupation" value={family.fatherOccupation} onChange={(e) => setFamily({ ...family, fatherOccupation: e.target.value })} /></Field>
          <Field label="Mother's Occupation" htmlFor="motherOccupation"><Input id="motherOccupation" value={family.motherOccupation} onChange={(e) => setFamily({ ...family, motherOccupation: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Family Background" htmlFor="familyBackground"><Textarea id="familyBackground" value={family.familyBackground} onChange={(e) => setFamily({ ...family, familyBackground: e.target.value })} /></Field>
          </div>
        </CardContent>
      </Card>

      <Button onClick={submit} disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Submit for Review
      </Button>
    </div>
  );
}
