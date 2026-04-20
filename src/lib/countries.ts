/**
 * Phone country codes shown in the signup form.
 * Saudi Arabia (+966) is the default and listed first.
 * The list is intentionally small — just GCC + a few common ones —
 * to keep the dropdown short and focused on MASAR's audience.
 */
export interface Country {
  code: string;   // dial code with leading +
  iso: string;    // ISO-3166 alpha-2
  name: string;
  flag: string;   // emoji
}

export const COUNTRIES: Country[] = [
  { code: "+966", iso: "SA", name: "Saudi Arabia",          flag: "🇸🇦" },
  { code: "+971", iso: "AE", name: "United Arab Emirates",  flag: "🇦🇪" },
  { code: "+973", iso: "BH", name: "Bahrain",               flag: "🇧🇭" },
  { code: "+974", iso: "QA", name: "Qatar",                 flag: "🇶🇦" },
  { code: "+965", iso: "KW", name: "Kuwait",                flag: "🇰🇼" },
  { code: "+968", iso: "OM", name: "Oman",                  flag: "🇴🇲" },
  { code: "+20",  iso: "EG", name: "Egypt",                 flag: "🇪🇬" },
  { code: "+962", iso: "JO", name: "Jordan",                flag: "🇯🇴" },
  { code: "+90",  iso: "TR", name: "Türkiye",               flag: "🇹🇷" },
  { code: "+44",  iso: "GB", name: "United Kingdom",        flag: "🇬🇧" },
  { code: "+1",   iso: "US", name: "United States",         flag: "🇺🇸" },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // +966
