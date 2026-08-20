# Bun changed-test selection verification

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Mechanism: clean temporary Git snapshot of the current backend, then `bun test --changed=HEAD`

| Change | Expected | Selected test files |
| --- | --- | --- |
| Model gateway source | src/consumer/modelGateway.bun.test.ts | src/consumer/modelGateway.bun.test.ts<br>src/localExtractionRunner.bun.test.ts<br>src/localExtractionRunnerRecovery.bun.test.ts<br>src/localLiveDocumentDeletion.bun.test.ts<br>src/localModelSettings.bun.test.ts<br>src/localWorkspaceInFlightDeletion.bun.test.ts<br>src/localWorkspaceLateWork.bun.test.ts<br>src/localWorkspaceProductStore.bun.test.ts |
| Workspace product-store source | src/localWorkspaceProductStore.bun.test.ts | src/localAuth.bun.test.ts<br>src/localDocumentDeletion.bun.test.ts<br>src/localExtractionRunner.bun.test.ts<br>src/localExtractionRunnerRecovery.bun.test.ts<br>src/localJobConditionalPolling.bun.test.ts<br>src/localJobExport.bun.test.ts<br>src/localJobPagination.bun.test.ts<br>src/localJobSearch.bun.test.ts<br>src/localLiveDocumentDeletion.bun.test.ts<br>src/localModelSettings.bun.test.ts<br>src/localRuntime.bun.test.ts<br>src/localSourceFileRetention.bun.test.ts<br>src/localWorkspaceControl.bun.test.ts<br>src/localWorkspaceDeletionInvalidation.bun.test.ts<br>src/localWorkspaceDeletionRecovery.bun.test.ts<br>src/localWorkspaceHardErase.bun.test.ts<br>src/localWorkspaceInFlightDeletion.bun.test.ts<br>src/localWorkspaceInvitations.bun.test.ts<br>src/localWorkspaceLateWork.bun.test.ts<br>src/localWorkspaceLeave.bun.test.ts<br>src/localWorkspaceMemberListing.bun.test.ts<br>src/localWorkspaceOperationCoordination.bun.test.ts<br>src/localWorkspaceProductStore.bun.test.ts<br>src/localWorkspaceProductStoreRegistry.bun.test.ts |
| Documentation only | no backend tests | none |
