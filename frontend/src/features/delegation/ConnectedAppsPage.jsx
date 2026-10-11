import React, { useMemo } from "react";
import { createNotifier } from "../../lib/notify";
import { copyWithFeedback } from "../../lib/copyWithFeedback";
import { CopyIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { confirmDialog } from "../ui/confirm.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { TextInput } from "../ui/Field.jsx";
import { PageHeader } from "../ui/PageHeader.jsx";
import { Badge, Tag } from "../ui/Status.jsx";
import { ListStatus } from "../ui/States.jsx";
import { clientHost, clientName, formatDateTime, provenanceLabel, scopeDescriptors } from "./delegationFormat.js";
import { useDelegatedResource } from "./useDelegatedResource.js";
import "./delegation.css";

// Account-level list of MCP clients the user has connected, one row per grant.
export function ConnectedAppsPage({ requests, toast }) {
  const resource = useDelegatedResource((signal) => requests.listConnections(signal));
  const notify = useMemo(() => createNotifier(toast), [toast]);
  const data = resource.data;
  const descriptors = scopeDescriptors(data?.scopes);
  const connections = (Array.isArray(data?.connections) ? data.connections : []).filter((item) => !item.revoked_at);
  const disabled = data?.enabled === false;

  async function disconnect(connection) {
    const name = clientName(connection.client);
    const workspace = connection.workspace?.name || "its workspace";

    const confirmed = await confirmDialog({
      title: `Disconnect "${name}"?`,
      body: `It loses access to ${workspace} straight away. Documents it already submitted keep processing.`,
      confirmLabel: "Disconnect app",
      pendingLabel: "Disconnecting…",
      action: async () => {
        try {
          await requests.revokeConnection(connection.id);
        } catch (error) {
          // Already disconnected elsewhere: the outcome the user asked for.
          if (error.code !== "mcp_connection_not_found" && error.status !== 404) throw error;
        }
      },
    });

    if (!confirmed || !resource.isCurrent()) return;

    notify("connectedApp.disconnect", "success", { targetName: name });
    resource.reload();
  }

  return (
    <>
      <PageHeader
        label="Connected apps"
        breadcrumbs={[{ label: "Account" }, { label: "Connected apps" }]}
        title="Connected apps"
        description="Apps you've allowed to act for you through MCP."
      />
      <div className="connected-apps">
        {disabled ? (
          <Callout tone="warning">Connected apps are turned off for this installation. You can still disconnect apps.</Callout>
        ) : null}
        {/* New apps can't connect while the installation has connected apps turned off. */}
        {data?.mcp_url && !disabled ? <ConnectionAddress url={data.mcp_url} toast={toast} /> : null}
        <section aria-labelledby="connected-apps-list-title">
          <div className="studio-section-heading">
            <div>
              <h2 id="connected-apps-list-title">Apps</h2>
            </div>
          </div>
          <ListStatus
            status={resource.status}
            error={resource.error}
            onRetry={resource.reload}
            isEmpty={connections.length === 0}
            emptyMessage={
              disabled ? "No apps are connected." : "No apps are connected. Add the connection address in an app that supports MCP."
            }
          >
            <div className="connected-apps-table">
              <DataTable label="Connected apps" compact>
              <thead>
                <tr>
                  <th scope="col">App</th>
                  <th scope="col">Workspace</th>
                  <th scope="col">Access</th>
                  <th scope="col">Connected</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <ConnectionRow
                    key={connection.id}
                    connection={connection}
                    descriptors={descriptors}
                    onDisconnect={() => void disconnect(connection)}
                  />
                ))}
              </tbody>
              </DataTable>
            </div>
          </ListStatus>
        </section>
      </div>
    </>
  );
}

function ConnectionRow({ connection, descriptors, onDisconnect }) {
  const name = clientName(connection.client);
  const host = clientHost(connection.client?.uri);
  const provenance = provenanceLabel(connection.client?.provenance);
  const scopes = Array.isArray(connection.scopes) ? connection.scopes : [];

  return (
    <tr>
      <td>
        <div className="connected-app-identity">
          <strong>{name}</strong>
          {host ? <span className="muted">{host}</span> : null}
          <Badge tone={provenance.tone}>{provenance.label}</Badge>
        </div>
      </td>
      <td>
        <div className="connected-app-identity">
          <span>{connection.workspace?.name || "—"}</span>
          {connection.workspace?.accessible === false ? <Badge tone="warning">No access</Badge> : null}
        </div>
      </td>
      <td>
        <ul className="connected-app-scopes" aria-label={`Access for ${name}`}>
          {scopes.map((scope) => (
            <li key={scope}>
              <Tag title={descriptors.get(scope)?.description}>{descriptors.get(scope)?.label || scope}</Tag>
            </li>
          ))}
        </ul>
      </td>
      <td>{formatDateTime(connection.created_at)}</td>
      <td>{formatDateTime(connection.last_used_at)}</td>
      <td className="connected-app-actions">
        <Button variant="danger-text" size="sm" aria-label={`Disconnect ${name}`} onClick={onDisconnect}>
          Disconnect
        </Button>
      </td>
    </tr>
  );
}

function ConnectionAddress({ url, toast }) {
  return (
    <section aria-labelledby="connected-apps-address-title">
      <div className="studio-section-heading">
        <div>
          <h2 id="connected-apps-address-title">Connection address</h2>
          <p>Add this address to an app that supports MCP, then sign in when it asks.</p>
        </div>
      </div>
      <div className="workspace-key-input connected-apps-address">
        <TextInput aria-label="Connection address" value={url} readOnly />
        <IconButton
          size="sm"
          label="Copy connection address"
          icon={CopyIcon}
          className="workspace-key-copy-button"
          onClick={() => void copyWithFeedback(toast, url, "Connection address")}
        />
      </div>
    </section>
  );
}
