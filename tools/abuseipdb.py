#!/usr/bin/env python3
"""
Tool: abuseipdb
Check IP address abuse confidence score via AbuseIPDB.
Requires: ABUSEIPDB_API_KEY environment variable

Input  (stdin JSON):
  ip           (str) - IP address to check
  max_age_days (int) - How many days back to look for reports  [default: 90]

Output (stdout JSON):
  ip_address       (str)  - The queried IP
  is_public        (bool) - Whether the IP is a public address
  abuse_confidence (int)  - Abuse confidence percentage (0-100)
  total_reports    (int)  - Total number of abuse reports
  last_reported    (str)  - ISO datetime of most recent report
  country_code     (str)  - ISO country code of the IP
  domain           (str)  - Reverse DNS hostname
  is_tor           (bool) - Whether the IP is a known Tor exit node
"""
import json, sys, os
import urllib.request, urllib.error, urllib.parse

API_URL = 'https://api.abuseipdb.com/api/v2/check'

def main():
    args    = json.load(sys.stdin)
    api_key = os.environ.get('ABUSEIPDB_API_KEY', '')
    ip      = args['ip']
    max_age = args.get('max_age_days', 90)

    params = urllib.parse.urlencode({'ipAddress': ip, 'maxAgeInDays': max_age, 'verbose': ''})
    req = urllib.request.Request(
        f'{API_URL}?{params}',
        headers={'Key': api_key, 'Accept': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(json.dumps({'error': f'AbuseIPDB error {e.code}: {e.read().decode()}'}))
        sys.exit(1)

    d = data.get('data', {})
    print(json.dumps({
        'ip_address':       d.get('ipAddress'),
        'is_public':        d.get('isPublic'),
        'abuse_confidence': d.get('abuseConfidenceScore'),
        'total_reports':    d.get('totalReports'),
        'last_reported':    d.get('lastReportedAt'),
        'country_code':     d.get('countryCode'),
        'domain':           d.get('domain'),
        'is_tor':           d.get('isTor'),
    }))

if __name__ == '__main__':
    main()
