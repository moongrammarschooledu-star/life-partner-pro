// A curated (not exhaustive) geo dataset for the registration form's country
// dropdown and city suggestions. City coverage is intentionally deepest for
// Pakistan (this platform's primary demographic, per the existing demo
// data) with a shorter list for other major countries — anywhere not
// covered still works fine as free text in the City field.

export const COUNTRIES = [
  "Pakistan", "India", "Bangladesh", "United Arab Emirates", "Saudi Arabia",
  "United Kingdom", "United States", "Canada", "Australia", "Qatar",
  "Kuwait", "Oman", "Bahrain", "Malaysia", "Turkey", "Germany", "France",
  "Afghanistan", "Sri Lanka", "China", "Singapore", "New Zealand",
  "South Africa", "Egypt", "Jordan", "Other",
];

const CITIES_BY_COUNTRY: Record<string, string[]> = {
  Pakistan: [
    "Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan",
    "Peshawar", "Quetta", "Sialkot", "Gujranwala", "Hyderabad", "Sargodha",
    "Bahawalpur", "Sukkur", "Abbottabad", "Sahiwal", "Mardan", "Gujrat",
  ],
  "United Arab Emirates": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain"],
  "Saudi Arabia": ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam"],
  "United Kingdom": ["London", "Birmingham", "Manchester", "Bradford", "Glasgow", "Luton"],
  "United States": ["New York", "Chicago", "Houston", "Los Angeles", "Dallas", "Atlanta"],
  Canada: ["Toronto", "Mississauga", "Vancouver", "Calgary", "Ottawa"],
  India: ["Mumbai", "Delhi", "Hyderabad", "Bangalore", "Chennai", "Lucknow"],
  Bangladesh: ["Dhaka", "Chittagong", "Sylhet"],
  Australia: ["Sydney", "Melbourne", "Brisbane", "Perth"],
};

export function citiesFor(country: string | undefined | null): string[] {
  if (!country) return [];
  return CITIES_BY_COUNTRY[country] ?? [];
}
