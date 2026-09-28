# GHL quote form — captured 2026-09-28 before cancellation

Source: https://api.closerpilotai.com/widget/form/k2o2hUenyRnKMz3rrBdI
(white-labeled GHL form "Form Dick", embedded as an iframe on /quote.html only)

On submit, GHL creates a contact, opens an empty conversation thread, and
emails Joel the submission. Nothing is sent to the submitter.

| # | Label | GHL field | Type | Required |
|---|-------|-----------|------|----------|
| 1 | First Name | first_name | text | yes |
| 2 | Last Name | last_name | text | yes |
| 3 | Phone | phone | tel (placeholder "+1 (555) 000-0000") | yes |
| 4 | Email | email | email (placeholder "your@email.com") | yes |
| 5 | Service Wanted | contact.multi_dropdown_1ozd | MULTI-select: Full Detail, Interior, Exterior | yes |
| 6 | Vehicle Type | contact.vehicle_type_2 | single select: Coupe/Sedan, SUV (2 Rows), Truck, SUV (3 Rows), Other (4+ Rows) | yes |
| 7 | Tell Us A Little About The Condition Of Your Vehicle | MmD7UPBSKR6I0icYujMB | text (placeholder "E.g., Excessive pet hair, heavy stains, caked on mud, etc.") | no |
| 8 | Postal Code | postal_code | text (placeholder "ZIP or postal code") | yes |
| 9 | SMS consent (non-marketing) | terms_and_conditions | checkbox | no |
| 10 | SMS consent (marketing) | — | checkbox | no |

Consent text, verbatim (A2P 10DLC-style language; keep exact):

1. By checking this box, I consent to receive non-marketing text messages from Detling's Detailing about Car Detailing Services. Message frequency varies, message & data rates may apply. Text HELP for assistance, reply STOP to opt out.

2. By checking this box, I consent to receive marketing and promotional messages including special offers, discounts, new product updates among others, from Detling's Detailing at the phone number provided. Frequency may vary. Message & data rates may apply. Text HELP for assistance, reply STOP to opt out.

Below the button: "Privacy Policy | Terms of Service" links. Button text: "Submit".
