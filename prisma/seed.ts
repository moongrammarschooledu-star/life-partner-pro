// Realistic but entirely fictional demo data (spec §45). No real photos —
// avatars are generated placeholder SVGs, not stored as ProfilePhoto rows,
// so the admin UI falls back to its initials avatar for every demo profile.
import { PrismaClient, Gender, MaritalStatus, ProfileStatus, FamilyType, FamilyStatus, EmploymentType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const CITIES = [
  { city: "Lahore", country: "Pakistan" },
  { city: "Karachi", country: "Pakistan" },
  { city: "Islamabad", country: "Pakistan" },
  { city: "Faisalabad", country: "Pakistan" },
  { city: "Multan", country: "Pakistan" },
  { city: "Dubai", country: "UAE" },
  { city: "London", country: "UK" },
  { city: "Toronto", country: "Canada" },
];

const EDUCATION = ["Bachelors", "Masters", "MPhil", "PhD", "Intermediate"];
const PROFESSIONS = [
  "Software Engineer",
  "Doctor",
  "Teacher",
  "Business Owner",
  "Accountant",
  "Civil Engineer",
  "Government Officer",
  "Architect",
  "Pharmacist",
  "Marketing Manager",
];
const MALE_NAMES = [
  "Ahmed Raza", "Bilal Khan", "Usman Tariq", "Hamza Sheikh", "Ali Hassan",
  "Faisal Mahmood", "Zeeshan Iqbal", "Omar Farooq", "Adeel Malik", "Kashif Nawaz",
];
const FEMALE_NAMES = [
  "Ayesha Siddiqui", "Sana Malik", "Mahnoor Aziz", "Zainab Hussain", "Hira Baig",
  "Fatima Noor", "Rabia Yousaf", "Amna Riaz", "Sadia Karim", "Nida Farooq",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateOfBirth(minAge: number, maxAge: number): Date {
  const age = minAge + Math.floor(Math.random() * (maxAge - minAge));
  const today = new Date();
  return new Date(today.getFullYear() - age, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28));
}

async function seedAdmins() {
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { email: "admin@lifepartnerpro.local" },
    update: {},
    create: {
      name: "Super Admin",
      email: "admin@lifepartnerpro.local",
      passwordHash,
      role: "SUPER_ADMIN",
    },
  });

  console.log("\nSeeded admin login:");
  console.log("  email:    admin@lifepartnerpro.local");
  console.log(`  password: ${password}`);
  console.log("  (change this immediately in a real deployment — see README)\n");
}

async function seedProfiles() {
  const existing = await prisma.profile.count();
  if (existing > 0) {
    console.log(`Profiles already exist (${existing}) — skipping demo profile seed.`);
    return;
  }

  const genders: { gender: Gender; names: string[] }[] = [
    { gender: "MALE", names: MALE_NAMES },
    { gender: "FEMALE", names: FEMALE_NAMES },
  ];

  let seq = 0;
  for (const group of genders) {
    for (const fullName of group.names) {
      seq++;
      const location = randomFrom(CITIES);
      const oppositeLocation = randomFrom(CITIES);
      const dob = randomDateOfBirth(23, 38);
      const counter = await prisma.profileCodeCounter.upsert({
        where: { id: 1 },
        update: { lastSeq: { increment: 1 } },
        create: { id: 1, lastSeq: 1 },
      });
      const profileCode = `LPP-${String(counter.lastSeq).padStart(6, "0")}`;

      const monthlyIncome = 800 + Math.floor(Math.random() * 4200);

      await prisma.profile.create({
        data: {
          profileCode,
          fullName,
          gender: group.gender,
          dateOfBirth: dob,
          maritalStatus: randomFrom<MaritalStatus>(["NEVER_MARRIED", "NEVER_MARRIED", "NEVER_MARRIED", "DIVORCED"]),
          heightCm: group.gender === "MALE" ? 165 + Math.floor(Math.random() * 25) : 150 + Math.floor(Math.random() * 20),
          city: location.city,
          area: "Model Town",
          country: location.country,
          nationality: location.country === "Pakistan" ? "Pakistani" : undefined,
          status: randomFrom<ProfileStatus>(["NEW", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "ACTIVE", "MATCHING"]),
          verified: Math.random() > 0.4,
          contact: {
            create: {
              mobileNumber: `+92300${String(1000000 + seq).slice(0, 7)}`,
              whatsappNumber: `+92300${String(1000000 + seq).slice(0, 7)}`,
              email: `demo.profile${seq}@example.com`,
              preferredContactMethod: "WHATSAPP",
            },
          },
          education: {
            create: {
              level: randomFrom(EDUCATION),
              degree: "BS/MS",
              institution: "University (demo data)",
            },
          },
          profession: {
            create: {
              profession: randomFrom(PROFESSIONS),
              jobTitle: randomFrom(PROFESSIONS),
              companyName: "Demo Company Pvt Ltd",
              employmentType: randomFrom<EmploymentType>(["PRIVATE", "GOVERNMENT", "BUSINESS_OWNER", "SELF_EMPLOYED"]),
              monthlyIncome,
              annualIncome: monthlyIncome * 12,
              workLocation: location.city,
            },
          },
          family: {
            create: {
              fatherOccupation: "Retired Government Officer",
              motherOccupation: "Homemaker",
              numberOfBrothers: Math.floor(Math.random() * 3),
              numberOfSisters: Math.floor(Math.random() * 3),
              familyType: randomFrom<FamilyType>(["NUCLEAR", "JOINT", "EXTENDED"]),
              familyStatus: randomFrom<FamilyStatus>(["MIDDLE_CLASS", "UPPER_MIDDLE_CLASS", "WELL_SETTLED"]),
              familyLocation: location.city,
            },
          },
          lifestyle: {
            create: {
              religion: "Islam",
              sect: randomFrom(["Sunni", "Shia", "Not specified"]),
              religiousPractice: randomFrom(["Practicing", "Moderate", "Liberal"]),
              languages: "Urdu, English",
              smoking: Math.random() > 0.85,
              drinking: false,
            },
          },
          preference: {
            create: {
              minAge: group.gender === "MALE" ? 22 : 25,
              maxAge: group.gender === "MALE" ? 32 : 38,
              preferredCountry: oppositeLocation.country,
              preferredCity: Math.random() > 0.5 ? oppositeLocation.city : undefined,
              minEducation: randomFrom(EDUCATION),
              professionPreference: Math.random() > 0.5 ? "ANY" : randomFrom(PROFESSIONS),
              minIncome: 1000,
              incomeFlexible: Math.random() > 0.5,
              maritalStatusPreference: "NEVER_MARRIED",
              minHeightCm: group.gender === "MALE" ? 150 : 165,
              maxHeightCm: group.gender === "MALE" ? 175 : 190,
              familyTypePreference: "ANY",
              familyBackgroundPreference: "ANY",
              additionalExpectations: "Looking for someone family-oriented, respectful, and career-conscious. (Demo data)",
            },
          },
          consent: {
            create: { agreedAt: new Date() },
          },
        },
      });
    }
  }

  console.log(`Seeded ${seq} demo profiles (clearly fictional — see prisma/seed.ts).`);
}

async function main() {
  await seedAdmins();
  await seedProfiles();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
