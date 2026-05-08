/**
 * Phone country codes shown in the signup form.
 * Saudi Arabia (+966) is the default and listed first.
 *
 * `localDigits` is the number of digits the user must enter AFTER the
 * country code. For Saudi Arabia the local subscriber number is 9 digits
 * (e.g. 5xxxxxxxx). Most other countries default to 9–10 digits.
 */
export interface Country {
  code: string;
  iso: string;
  name: string;
  flag: string;
  localDigits: number;
}

export const COUNTRIES: Country[] = [
  { code: "+966", iso: "SA", name: "Saudi Arabia",         flag: "🇸🇦", localDigits: 9 },
  { code: "+971", iso: "AE", name: "United Arab Emirates", flag: "🇦🇪", localDigits: 9 },
  { code: "+973", iso: "BH", name: "Bahrain",              flag: "🇧🇭", localDigits: 8 },
  { code: "+974", iso: "QA", name: "Qatar",                flag: "🇶🇦", localDigits: 8 },
  { code: "+965", iso: "KW", name: "Kuwait",               flag: "🇰🇼", localDigits: 8 },
  { code: "+968", iso: "OM", name: "Oman",                 flag: "🇴🇲", localDigits: 8 },
  { code: "+20",  iso: "EG", name: "Egypt",                flag: "🇪🇬", localDigits: 10 },
  { code: "+962", iso: "JO", name: "Jordan",               flag: "🇯🇴", localDigits: 9 },
  { code: "+90",  iso: "TR", name: "Türkiye",              flag: "🇹🇷", localDigits: 10 },
  { code: "+44",  iso: "GB", name: "United Kingdom",       flag: "🇬🇧", localDigits: 10 },
  { code: "+1",   iso: "US", name: "United States",        flag: "🇺🇸", localDigits: 10 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];
