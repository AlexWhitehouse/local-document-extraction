import React, { useMemo, useState } from "react";
import { createNotifier } from "../../lib/notify";
import { formatUploadLimit, validateSourceFiles } from "../documents/sourceFileValidation.js";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { Dropzone } from "../ui/Dropzone.jsx";
import { Badge } from "../ui/Status.jsx";
import { LoadingState } from "../ui/States.jsx";
import { useAsyncAction } from "../ui/useAsyncAction";
import { DelegatedCard, DelegatedLoadFailure } from "./DelegatedCard.jsx";
import { clientName, formatDateTime } from "./delegationFormat.js";
import { useDelegatedResource } from "./useDelegatedResource.js";

const UNAVAILABLE_CODES = new Set(["mcp_upload_not_found", "mcp_connection_revoked", "mcp_workspace_unavailable"]);

const CLOSED_CODES = new Set(["mcp_upload_expired", "mcp_upload_used", ...UNAVAILABLE_CODES]);

// Stages one document for an MCP client. The app submits it for processing afterwards.
export function UploadPage({ requests, uploadId, toast }) {
  const upload = useDelegatedResource((signal) => requests.getUpload(uploadId, signal));

  if (upload.status === "loading") {
    return (
      <DelegatedCard eyebrow="Upload for an app" title="Upload a document">
        <LoadingState variant="panel" label="Loading upload link…" />
      </DelegatedCard>
    );
  }

  if (upload.status === "error") {
    // An expired link is refused on load; the app that sent it can't be named then.
    if (upload.error?.code === "mcp_upload_expired" || upload.error?.status === 410) {
      return (
        <DelegatedCard eyebrow="Upload for an app" title="Upload link expired" status={<Badge tone="neutral">Expired</Badge>}>
          <Callout tone="warning">This upload link has expired. Ask the app for a new one.</Callout>
        </DelegatedCard>
      );
    }

    const unavailable = UNAVAILABLE_CODES.has(upload.error?.code) || [403, 404].includes(upload.error?.status);

    return (
      <DelegatedCard eyebrow="Upload for an app" title={unavailable ? "Upload link unavailable" : "Upload a document"}>
        {unavailable ? (
          <Callout tone="warning" role="alert">
            This link doesn&apos;t exist, belongs to another account, or its app was disconnected.
          </Callout>
        ) : (
          <DelegatedLoadFailure error={upload.error} fallback="Couldn't load this upload link." onRetry={upload.reload} />
        )}
      </DelegatedCard>
    );
  }

  return (
    <UploadForm
      upload={upload.data}
      requests={requests}
      toast={toast}
      isCurrent={upload.isCurrent}
      onUploaded={(result) => upload.replace({ ...upload.data, status: result?.status || "uploaded" })}
      onReload={upload.reload}
    />
  );
}

function UploadForm({ upload, requests, toast, isCurrent, onUploaded, onReload }) {
  const notify = useMemo(() => createNotifier(toast), [toast]);
  const name = clientName(upload.client);
  const workspace = upload.workspace?.name || "a workspace";
  const maxBytes = Number(upload.max_source_file_bytes) || 0;
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [isUploading, runUpload] = useAsyncAction(submit);

  function choose(files) {
    const [first, ...rest] = files;
    const { accepted, rejections } = validateSourceFiles([first], maxBytes);

    if (rest.length) {
      setFileError("Choose one file.");

      return;
    }

    setFile(accepted[0] || null);
    setFileError(rejections[0] ? `${rejections[0]}.` : "");
  }

  async function submit() {
    if (!file) {
      setFileError("Choose a file to upload.");

      return;
    }

    try {
      const result = await requests.uploadFile(upload.id, file);

      if (!isCurrent()) return;

      notify("mcpUpload.upload", "success", { targetName: file.name });
      onUploaded(result);
    } catch (error) {
      if (!isCurrent()) return;

      notify("mcpUpload.upload", "failure", { targetName: file.name, error });

      // The link closed while the file was chosen; show why instead of the form.
      if (CLOSED_CODES.has(error.code)) onReload();
    }
  }

  const header = {
    eyebrow: `Upload for ${name}`,
    title: "Upload a document",
    description: `${name} will submit it for processing in ${workspace}.`,
  };

  if (upload.status === "uploaded") {
    return (
      <DelegatedCard {...header} status={<Badge tone="success">Uploaded</Badge>}>
        <Callout tone="success">Return to {name} to continue. It submits the document for processing.</Callout>
      </DelegatedCard>
    );
  }

  if (upload.status !== "pending") {
    return (
      <DelegatedCard {...header} status={<Badge tone="neutral">Expired</Badge>}>
        <Callout tone="warning">This upload link has expired. Ask {name} for a new one.</Callout>
      </DelegatedCard>
    );
  }

  return (
    <DelegatedCard {...header}>
      <form
        className="delegated-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void runUpload();
        }}
      >
        <div className={["ui-field", fileError && "has-error"].filter(Boolean).join(" ")}>
          <Dropzone
            label="Choose a document"
            prompt={file ? file.name : "Drop a file or click to browse"}
            hint={`PDF, PNG, JPG or WEBP, up to ${formatUploadLimit(maxBytes)}`}
            multiple={false}
            disabled={isUploading}
            onFiles={choose}
          />
          {fileError ? (
            <p id="mcp-upload-error" className="ui-field-error" role="alert">
              {fileError}
            </p>
          ) : null}
        </div>
        <p className="muted">Link expires {formatDateTime(upload.expires_at)}.</p>
        <div className="actions delegated-actions">
          <Button type="submit" pending={isUploading} pendingLabel="Uploading…">
            Upload
          </Button>
        </div>
      </form>
    </DelegatedCard>
  );
}
