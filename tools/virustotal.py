#!/usr/bin/env python3
"""
Tool: virustotal
Check the reputation of IPs, domains, URLs, or file hashes via VirusTotal.
Requires: VIRUSTOTAL_API_KEY environment variable

Input  (stdin JSON):
  query (str)  - IP address, domain, URL, or file hash to check
  type  (str)  - 'ip' | 'domain' | 'url' | 'hash'   [default: 'ip']

Output (stdout JSON):
  malicious       (bool) - True if any engine flagged as malicious
  malicious_count (int)  - Number of engines that flagged it
  total_engines   (int)  - Total engines that scanned
  categories      (list) - Threat categories reported
  country         (str)  - Country of IP (if type=ip)
  details         (dict) - Full VirusTotal attributes
"""
import json, sys, os
import urllib.request
import urllib.error

BASE = 'https://www.virustotal.com/api/v3'

def main():
    args      = json.load(sys.stdin)
    api_key   = os.environ.get('VIRUSTOTAL_API_KEY', '')
    query     = args.get('query', '')
    qtype     = args.get('type', 'ip')

    endpoints = {
        'ip':     f'{BASE}/ip_addresses/{query}',
        'domain': f'{BASE}/domains/{query}',
        'hash':   f'{BASE}/files/{query}',
        'url':    f'{BASE}/urls/{query}',
    }
    url = endpoints.get(qtype, endpoints['ip'])

    req = urllib.request.Request(url, headers={'x-apikey': api_key})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(json.dumps({'error': f'VirusTotal API error {e.code}: {e.read().decode()}'}))
        sys.exit(1)

    attrs  = data.get('data', {}).get('attributes', {})
    stats  = attrs.get('last_analysis_stats', {})
    mal    = stats.get('malicious', 0)
    total  = sum(stats.values()) if stats else 0

    print(json.dumps({
        'malicious':       mal > 0,
        'malicious_count': mal,
        'total_engines':   total,
        'categories':      list(attrs.get('categories', {}).values()),
        'country':         attrs.get('country', ''),
        'details':         attrs,
    }))

if __name__ == '__main__':
    main()
