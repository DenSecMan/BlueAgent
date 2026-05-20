# Skill: Threat Analysis

Call the relevant tools for the provided indicator and summarise what they return.

## Tool selection by indicator type

| Indicator | Tools to call |
|---|---|
| IP address | virustotal, abuseipdb, alienvault_otx |
| Domain | virustotal, alienvault_otx |
| File hash (MD5/SHA1/SHA256) | virustotal, alienvault_otx |
| CVE | nvd_lookup |

Call all relevant tools for the indicator type. If a tool errors or returns no data, note that briefly.

## Summarising results

Format the response in markdown so it renders clearly in the UI.
- Use a bold heading per tool, e.g. **VirusTotal**, **AbuseIPDB**, **AlienVault OTX**, **NVD**
- Under each heading, one or two bullet points summarising what that tool returned
- Report only what the tools returned — no invented context, no padding
- If tools return a reputation score, detection count, or severity rating, include it
- If a tool errors or returns nothing useful, note it briefly under that heading
