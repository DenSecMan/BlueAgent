#!/usr/bin/env python3
"""
Tool: azure_sentinel
Run KQL queries against Azure Log Analytics / Microsoft Sentinel.
Requires: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
          AZURE_WORKSPACE_ID environment variables

Input  (stdin JSON):
  query        (str) - KQL query to execute
  timespan     (str) - ISO 8601 duration e.g. 'PT1H', 'P1D', 'PT24H'  [default: 'PT24H']
  workspace_id (str) - Override workspace ID  [default: AZURE_WORKSPACE_ID env var]

Output (stdout JSON):
  columns (list) - Column names
  rows    (list) - Result rows as lists of values
  count   (int)  - Number of rows returned
"""
import json, sys, os
import urllib.request, urllib.error, urllib.parse

TOKEN_URL  = 'https://login.microsoftonline.com/{tenant}/oauth2/token'
QUERY_URL  = 'https://api.loganalytics.io/v1/workspaces/{workspace}/query'

def get_token(tenant, client_id, client_secret):
    body = urllib.parse.urlencode({
        'grant_type':    'client_credentials',
        'client_id':     client_id,
        'client_secret': client_secret,
        'resource':      'https://api.loganalytics.io',
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL.format(tenant=tenant), data=body, method='POST'
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['access_token']

def main():
    args         = json.load(sys.stdin)
    tenant       = os.environ['AZURE_TENANT_ID']
    client_id    = os.environ['AZURE_CLIENT_ID']
    client_secret = os.environ['AZURE_CLIENT_SECRET']
    workspace    = args.get('workspace_id') or os.environ['AZURE_WORKSPACE_ID']
    kql          = args['query']
    timespan     = args.get('timespan', 'PT24H')

    token   = get_token(tenant, client_id, client_secret)
    payload = json.dumps({'query': kql, 'timespan': timespan}).encode()
    req = urllib.request.Request(
        QUERY_URL.format(workspace=workspace),
        data=payload,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(json.dumps({'error': f'Log Analytics error {e.code}: {e.read().decode()}'}))
        sys.exit(1)

    table   = data.get('tables', [{}])[0]
    columns = [c['name'] for c in table.get('columns', [])]
    rows    = table.get('rows', [])
    print(json.dumps({'columns': columns, 'rows': rows, 'count': len(rows)}))

if __name__ == '__main__':
    main()
