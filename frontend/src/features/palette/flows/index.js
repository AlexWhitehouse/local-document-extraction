import { CreateTemplateFlow } from "./CreateTemplateFlow.jsx";
import { DeleteFlow } from "./DeleteFlow.jsx";
import { EditTemplateFlow } from "./EditTemplateFlow.jsx";
import { EvaluationFlow } from "./EvaluationFlow.jsx";
import { ExportFlow } from "./ExportFlow.jsx";
import { InviteFlow } from "./InviteFlow.jsx";
import { RetryFlow } from "./RetryFlow.jsx";
import { SwitchWorkspaceFlow } from "./SwitchWorkspaceFlow.jsx";
import { UploadFlow } from "./UploadFlow.jsx";

/**
 * Every CommandAction with its title and the flow that finishes it inside the palette.
 * Finding documents or templates and going to a page run in the palette shell itself, so they
 * have no flow component.
 */
export const FLOW_REGISTRY = Object.freeze({
  find_documents: { title: "Find documents", Component: null },
  find_templates: { title: "Find templates", Component: null },
  go_to: { title: "Go to", Component: null },
  edit_template: { title: "Edit template", Component: EditTemplateFlow },
  create_template: { title: "Create template", Component: CreateTemplateFlow },
  upload: { title: "Upload documents", Component: UploadFlow },
  retry: { title: "Try again", Component: RetryFlow },
  export: { title: "Export", Component: ExportFlow },
  delete: { title: "Delete documents", Component: DeleteFlow },
  invite: { title: "Invite member", Component: InviteFlow },
  switch_workspace: { title: "Switch workspace", Component: SwitchWorkspaceFlow },
  run_evaluation: { title: "Run evaluation", Component: EvaluationFlow },
});
