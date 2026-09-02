# Choose the authority boundary for Workspace model configuration

Type: grilling
Status: resolved
Parent: ../map.md
Blocked by: none

## Question

Which durable authority should own **Workspace model configuration**, and what read seam should the **Local extraction runner** use to obtain the configuration for exactly one Workspace without retaining an application-wide configuration singleton?

Resolve whether the configuration belongs with **Workspace control data**, **Workspace product data**, or a distinct secret/configuration store. Account for Workspace creation, replacement, hard erasure, product-store leases, runner recovery, backups, and the rule that every new and existing Workspace begins unconfigured at cutover.

## Answer

**Workspace model configuration** is authoritative **Workspace product data**. It does not belong in **Workspace control data**, an application-wide singleton, or a second configuration/secret store.

Each Workspace has at most one configuration. Absence is the complete unconfigured state: no placeholder configuration row is created, and creating or replacing a Workspace does not eagerly create its product database. Saving configuration may lazily initialise the product database in the same way that first use of other Workspace product features does.

Workspace-scoped settings and Document-submission handlers access configuration through the existing Workspace product-store lease after Workspace authorisation. The **Local extraction runner** reads the configuration for the job's Workspace through the same leased product-store interface it already uses to claim and complete that job; it no longer depends on an application-wide configuration provider.

Configuration follows the full lifecycle boundary of its authoritative Workspace product database. Runner recovery can read it whenever recoverable jobs exist, Workspace hard erasure removes it with the remaining Workspace product data, and backup/restore includes it so a restored Workspace is not silently missing part of its authoritative state. A backup containing configuration is therefore secret-bearing local state; encryption, file permissions, redaction, and backup-handling requirements are resolved by **Define the Workspace model configuration and credential lifecycle**.
