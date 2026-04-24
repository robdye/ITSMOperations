# Package Management API Reference

> Source: `GET /beta/copilot/admin/catalog/packages`
> Requires: Frontier program enrollment

## copilotPackage Resource

| Property | Type | Description |
|---|---|---|
| id | String | Unique identifier for the package within the tenant |
| displayName | String | Human-readable name shown to users and administrators |
| type | packageType | Classification: microsoft, external, shared, custom |
| shortDescription | String | Brief overview of functionality |
| isBlocked | Boolean | Whether the package is administratively blocked |
| availableTo | packageStatus | Access scope: all, some, none |
| deployedTo | packageStatus | Deployment scope: all, some, none |
| lastModifiedDateTime | DateTimeOffset | Last modification timestamp |
| supportedHosts | String[] | Host apps: teams, outlook, sharePoint |
| elementTypes | String[] | Element types: bot, declarativeAgent, customEngineAgent |
| publisher | String | Publishing organization |
| platform | String | Target platform: teams, outlook, web |
| version | String | Package version (immutable after creation) |
| manifestId | String | Manifest identifier (immutable after creation) |
| appId | String | Azure AD app registration ID |

## copilotPackageDetail (extends copilotPackage)

Additional properties:

| Property | Type | Description |
|---|---|---|
| longDescription | String | Detailed description |
| categories | String[] | Category tags (e.g., Development, Productivity) |
| sensitivity | String | Data handling classification |
| acquireUsersAndGroups | packageAccessEntity[] | Users/groups that installed the package |
| allowedUsersAndGroups | packageAccessEntity[] | Users/groups permitted access |
| elementDetails | packageElementDetail[] | Detailed element configuration |

## packageStatus Enum

| Value | Meaning |
|---|---|
| none | Not available/deployed to any users |
| some | Available/deployed to some users/groups |
| all | Available/deployed to all users |

## packageType Enum

| Value | Meaning |
|---|---|
| microsoft | Built by Microsoft |
| external | Built by partners |
| shared | Shared in your organization |
| custom | Built by your organization |

## API Operations

| Operation | Method | Endpoint |
|---|---|---|
| List packages | GET | /copilot/admin/catalog/packages |
| Create package | POST | /copilot/admin/catalog/packages |
| Get details | GET | /copilot/admin/catalog/packages/{id} |
| Update metadata | PATCH | /copilot/admin/catalog/packages/{id} |
| Delete | DELETE | /copilot/admin/catalog/packages/{id} |
| Block | POST | /copilot/admin/catalog/packages/{id}/block |
| Unblock | POST | /copilot/admin/catalog/packages/{id}/unblock |
| Update with file | POST | /copilot/admin/catalog/packages/{id}/update |
| Reassign owner | POST | /copilot/admin/catalog/packages/{id}/reassign |
