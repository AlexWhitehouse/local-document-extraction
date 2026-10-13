import React from "react";
import { WorkspaceIcon } from "../../layout/Icons.jsx";
import { Badge } from "../../ui/Status.jsx";
import { PickList } from "./flowParts.jsx";

/** Switch workspace: a filterable list of the workspaces you belong to; the current one is marked. */
export function SwitchWorkspaceFlow({ interpretation, context, onFinish }) {
  const items = (context.workspaces ?? []).map((workspace) => ({
    id: workspace.id,
    label: workspace.name || workspace.id,
    icon: WorkspaceIcon,
    badge: workspace.id === context.workspaceId ? <Badge tone="success">Current</Badge> : null,
  }));

  return (
    <PickList
      label="Switch workspace"
      placeholder="Filter workspaces"
      emptyMessage="No workspaces match."
      initialQuery={interpretation?.args?.workspace ?? ""}
      items={items}
      onPick={(item) => {
        if (item.id !== context.workspaceId) context.navigate(context.appPath({ workspaceId: item.id }));
        onFinish();
      }}
    />
  );
}
