#!/usr/bin/env python3
"""
Tool: nvd_lookup
Look up CVE vulnerability details from the NIST National Vulnerability Database.
Requires: NVD_API_KEY environment variable (optional but increases rate limits)

Input  (stdin JSON):
  cve_id      (str) - Specific CVE ID e.g. 'CVE-2024-1234'  (mutually exclusive with keyword)
  keyword     (str) - Keyword to search for CVEs             (mutually exclusive with cve_id)
  max_results (int) - Max results for keyword search  [default: 5]

Output (stdout JSON):
  cves (list) - CVE records, each with:
    id             (str)   - CVE identifier
    description    (str)   - English description
    cvss_score     (float) - Base CVSS score (v3.1 preferred, falls back to v3.0)
    severity       (str)   - CRITICAL | HIGH | MEDIUM | LOW
    published_date (str)   - ISO publication date
"""
import json, sys, os
import urllib.request, urllib.error, urllib.parse

API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0'

def main():
    args        = json.load(sys.stdin)
    api_key     = os.environ.get('NVD_API_KEY', '')
    cve_id      = args.get('cve_id')
    keyword     = args.get('keyword')
    max_results = args.get('max_results', 5)

    params = {}
    if cve_id:
        params['cveId'] = cve_id
    elif keyword:
        params['keywordSearch']  = keyword
        params['resultsPerPage'] = max_results
    else:
        print(json.dumps({'error': 'Provide either cve_id or keyword'}))
        sys.exit(1)

    qs      = urllib.parse.urlencode(params)
    headers = {'apiKey': api_key} if api_key else {}
    req     = urllib.request.Request(f'{API_URL}?{qs}', headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(json.dumps({'error': f'NVD API error {e.code}: {e.read().decode()}'}))
        sys.exit(1)

    results = []
    for vuln in data.get('vulnerabilities', []):
        cve   = vuln.get('cve', {})
        desc  = next((d['value'] for d in cve.get('descriptions', []) if d['lang'] == 'en'), '')
        mets  = cve.get('metrics', {})
        cvss  = (mets.get('cvssMetricV31') or mets.get('cvssMetricV30') or [{}])[0]
        cdata = cvss.get('cvssData', {})
        results.append({
            'id':             cve.get('id'),
            'description':    desc,
            'cvss_score':     cdata.get('baseScore'),
            'severity':       cdata.get('baseSeverity'),
            'published_date': cve.get('published'),
        })

    print(json.dumps({'cves': results}))

if __name__ == '__main__':
    main()
