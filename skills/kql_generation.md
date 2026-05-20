# Skill: KQL Query Generation

Generate valid KQL for Microsoft Sentinel / Azure Log Analytics from natural language.

## Output format
Present only the results in plain, conversational language.
- Do NOT include the KQL query in your response
- Do NOT explain what the query does
- For counts: one sentence — e.g. "There have been 42 high severity incidents today."
- For tabular data: a concise bullet list or table of the key fields only
- If the tool errors: one sentence describing the error

## Common tables

| Intent | Table |
|---|---|
| Incidents | SecurityIncident |
| Alerts | SecurityAlert |
| Sign-ins | SigninLogs |
| Azure AD audit | AuditLogs |
| Azure resource ops | AzureActivity |
| Linux syslog | Syslog |
| CEF/firewall logs | CommonSecurityLog |
| Zscaler web logs | HUNT_Zscaler |
| Palo Alto firewall logs | HUNT_PaloAlto |
| Checkpoint firewall logs | HUNT_Checkpoint |
| Defender process events | HUNT_XDRDeviceProcessEvents |
| Defender network events | HUNT_XDRDeviceNetworkEvents |
| M365 activity | OfficeActivity |

## Network & security data sources via Sentinel functions

| Source | Sentinel function | Typical use |
|---|---|---|
| Zscaler web proxy | HUNT_Zscaler | Web traffic, URL categories, blocked requests, user browsing |
| Palo Alto firewall | HUNT_PaloAlto | Firewall allow/deny, threat logs, traffic between zones |
| Checkpoint firewall | HUNT_Checkpoint | Firewall policy hits, IPS events, VPN activity |

## Defender (XDR) tables via Sentinel functions
All Microsoft Defender tables are exposed in Sentinel as functions with the `HUNT_XDR` prefix.
Always use the Sentinel function name, never the raw Defender table name.

| Raw Defender table | Sentinel function |
|---|---|
| DeviceProcessEvents | HUNT_XDRDeviceProcessEvents |
| DeviceNetworkEvents | HUNT_XDRDeviceNetworkEvents |
| DeviceFileEvents | HUNT_XDRDeviceFileEvents |
| DeviceLogonEvents | HUNT_XDRDeviceLogonEvents |
| DeviceRegistryEvents | HUNT_XDRDeviceRegistryEvents |
| DeviceImageLoadEvents | HUNT_XDRDeviceImageLoadEvents |
| DeviceEvents | HUNT_XDRDeviceEvents |
| DeviceInfo | HUNT_XDRDeviceInfo |

## KQL patterns

**Filter by incident number**
```kql
SecurityIncident | where IncidentNumber == 232323 | take 1
```

**Recent high-severity incidents**
```kql
SecurityIncident
| where TimeGenerated > ago(24h)
| where Severity in ("High", "Critical")
| project IncidentNumber, Title, Severity, Status, TimeGenerated
| sort by TimeGenerated desc
```

**Failed sign-ins for a user**
```kql
SigninLogs
| where TimeGenerated > ago(7d)
| where UserPrincipalName == "user@domain.com"
| where ResultType != 0
| project TimeGenerated, UserPrincipalName, ResultType, ResultDescription, IPAddress
```

**Summarise alerts by severity**
```kql
SecurityAlert
| where TimeGenerated > ago(24h)
| summarize Count=count() by AlertSeverity
| sort by Count desc
```

## Schema-first (mandatory)
Before writing any query, call the `azure_sentinel` tool with `TableName | getschema` to retrieve the exact column names and types for the target table. Never assume field names — always confirm them from the schema first.

```kql
HUNT_Zscaler | getschema
```

Use the returned `ColumnName` and `ColumnType` values to construct the query. If the schema call fails, state clearly which table you cannot reach and return the query with a note that column names are unverified.

## Rules
- Always include a time filter (`TimeGenerated > ago(...)`) unless the query targets a specific record by ID
- Use `| project` to limit columns to what was asked — never return all columns for wide tables
- Always end every query with `| take 50` unless the user explicitly requests a different limit or the query is a pure aggregation (`summarize`)
- Prefer `has` over `contains` for performance on large string fields
- Use `in~` for case-insensitive list membership, `=~` for case-insensitive equality
- When the user says "last N days/hours", convert to `ago(Nd)` or `ago(Nh)`
- If the request is ambiguous about which table to use, pick the most specific one and note your assumption

## Deduplication (always apply)

### Why this matters
Azure Log Analytics is an **immutable, append-only database**. Records are never updated
in place — every state change appends a new row. A single incident that changes severity
twice and closes will have three or more rows in `SecurityIncident`. A raw `count()` will
overcount because it counts rows, not incidents.

Always deduplicate before counting or listing results.

### How to deduplicate

**SecurityIncident — count distinct incidents**
Use `arg_max` to keep only the most recent row per `IncidentNumber`, then count:
```kql
SecurityIncident
| where TimeGenerated > ago(1d)
| where Severity == "High"
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| summarize Count = count()
```

**Most recent record per entity** — for any table where one logical entity produces
multiple rows (alerts, sign-ins, incidents):
```kql
| summarize arg_max(TimeGenerated, *) by EntityField
```

**Distinct rows** — use when all projected columns together define uniqueness:
```kql
| distinct Column1, Column2, Column3
```

**Count-based aggregation** — deduplicates implicitly only when grouping by the right
key; still apply `arg_max` first if the table is append-only:
```kql
| summarize Count=count() by FieldName
```

Apply deduplication after `| project` and before `| sort` / `| take`.
Default: `arg_max(TimeGenerated, *) by <unique key>` for all Sentinel tables.
