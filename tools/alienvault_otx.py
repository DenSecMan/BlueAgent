#!/usr/bin/env python3
"""
Tool: alienvault_otx
Query AlienVault OTX for threat intelligence on IPs, domains, or file hashes.
Requires: ALIENVAULT_OTX_API_KEY environment variable

Input  (stdin JSON):
  query (str) - IP address, domain, or file hash to look up
  type  (str) - 'ip' | 'domain' | 'hash'   [default: 'ip']

Output (stdout JSON):
  reputation       (int)  - OTX reputation score
  pulse_count      (int)  - Number of threat intelligence pulses referencing this indicator
  malware_families (list) - Associated malware family names
  tags             (list) - Threat tags from pulse data
  pulses           (list) - Up to 5 most recent pulse summaries (name, created, tlp, tags)
"""
import json, sys, os
import urllib.request, urllib.error

API_BASE = 'https://otx.alienvault.com/api/v1'

def main():
    args    = json.load(sys.stdin)
    api_key = os.environ.get('ALIENVAULT_OTX_API_KEY', '')
    query   = args['query']
    qtype   = args.get('type', 'ip')

    paths = {
        'ip':     f'/indicators/IPv4/{query}/general',
        'domain': f'/indicators/domain/{query}/general',
        'hash':   f'/indicators/file/{query}/general',
    }
    url = f'{API_BASE}{paths.get(qtype, paths["ip"])}'
    req = urllib.request.Request(url, headers={'X-OTX-API-KEY': api_key})

    try:
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(json.dumps({'error': f'OTX API error {e.code}: {e.read().decode()}'}))
        sys.exit(1)

    pulse_info = data.get('pulse_info', {})
    pulses     = pulse_info.get('pulses', [])[:5]

    print(json.dumps({
        'reputation':       data.get('reputation', 0),
        'pulse_count':      pulse_info.get('count', 0),
        'malware_families': data.get('malware_families', []),
        'tags':             pulse_info.get('tags', []),
        'pulses': [
            {'name': p.get('name'), 'created': p.get('created'), 'tlp': p.get('tlp'), 'tags': p.get('tags', [])}
            for p in pulses
        ],
    }))

if __name__ == '__main__':
    main()
