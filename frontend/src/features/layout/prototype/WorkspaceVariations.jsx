import React, { useState } from "react";
import { MEMBERS } from "./sampleData.js";
import { PageHeading, SectionHeading, Status } from "./PrototypeShared.jsx";

export function WorkspaceVariations({ workspace, onRename, notify, onCreate, onDelete }) {
  const [name, setName] = useState(workspace.name);
  const [gateway, setGateway] = useState("https://gateway.example.com/v1");
  const [model, setModel] = useState("studio-extract");
  const [members, setMembers] = useState(MEMBERS);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Member");
  const [showKey, setShowKey] = useState(false);
  const [keyVersion, setKeyVersion] = useState(1);
  const [tested, setTested] = useState(false);
  const general = <div className="lp-form">
    <form className="lp-name-field" onSubmit={event => { event.preventDefault(); if (name.trim()) { onRename(name.trim()); notify("Workspace name saved in this preview."); } }}>
      <label htmlFor="lp-workspace-name">Workspace name</label>
      <div className="lp-name-input"><input id="lp-workspace-name" value={name} onChange={event => setName(event.target.value)} /><button type="submit" className="secondary" disabled={!name.trim() || name.trim() === workspace.name}>Save name</button></div>
    </form>
    <div className="lp-definition-row"><span>Workspace ID</span><code>{workspace.id}</code></div>
    <div className="lp-definition-row"><span>Your role</span><strong>Owner</strong></div>
  </div>;
  const api = <div className="lp-form">
    <label>Workspace API key<div className="lp-input-action"><input aria-label="Workspace API key" readOnly type={showKey ? "text" : "password"} value={`demo_workspace_key_${keyVersion}`} /><button className="secondary" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button></div></label>
    <div className="lp-form-footer"><span>For inbound requests to this workspace.</span><button className="lp-text-button" onClick={() => { setKeyVersion(keyVersion + 1); notify("Demo key rotated in memory."); }}>Rotate key ↗</button></div>
  </div>;
  const modelForm = <div className="lp-form">
    <label>Gateway URL<input value={gateway} onChange={event => { setGateway(event.target.value); setTested(false); }} /></label>
    <div className="lp-two-col"><label>Model name<input value={model} onChange={event => { setModel(event.target.value); setTested(false); }} /></label><label>Gateway API key<input type="password" defaultValue="demo_gateway_key" autoComplete="off" /></label></div>
    <details className="lp-mini-details"><summary>Capabilities & call behavior</summary><label className="lp-checkbox"><input type="checkbox" defaultChecked /> Direct PDF input</label><label className="lp-checkbox"><input type="checkbox" defaultChecked /> Structured output</label></details>
    <div className="lp-form-footer"><Status>{tested ? "Demo connection successful" : "Configured"}</Status><div className="lp-action-row"><button className="secondary" onClick={() => { setTested(true); notify("Simulated connection check passed. No network request was made."); }}>Test connection</button><button onClick={() => notify("Model configuration saved in this preview.")}>Save configuration</button></div></div>
  </div>;
  const people = <>
    <SectionHeading title="Workspace users" description="The people who can access this workspace."><button className="secondary" onClick={() => setInvite(!invite)}>{invite ? "Cancel" : "+ Invite user"}</button></SectionHeading>
    {invite && <form className="lp-invite" onSubmit={event => { event.preventDefault(); setMembers([...members, { name: email.split("@")[0], email, role: `${role} · Invited`, initials: email.slice(0, 2).toUpperCase() }]); setEmail(""); setInvite(false); notify("Invitation added to this preview. No email was sent."); }}><label>Invite email<input type="email" required placeholder="teammate@example.com" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Role<select value={role} onChange={event => setRole(event.target.value)}><option>Member</option><option>Admin</option></select></label><button>Invite user</button></form>}
    <div className="lp-member-list" role="region" aria-label="Workspace user list" tabIndex={0}>{members.map(member => <div className="lp-member" key={member.email}><span className="lp-initials">{member.initials}</span><div><strong>{member.name}</strong><span>{member.email}</span></div><span className="lp-member-role">{member.role}</span></div>)}</div>
    <p className="lp-muted">{members.length} users · Access is managed by owners and admins.</p>
  </>;
  const content = { general, api, modelForm, people };
  return <div className="lp-workspace lp-A1">
    <PageHeading eyebrow="Workspaces / Overview" title={workspace.name} description="Your extraction environment, connections and people."><button className="secondary" onClick={onCreate}>Create Workspace</button><button className="danger" onClick={onDelete}>Delete Workspace</button></PageHeading>
    <A1 {...content} />
  </div>;
}

function A1({ general, api, modelForm, people }) {
  return <><div className="lp-open-settings"><section><SectionHeading title="Workspace details" description="The basics for this environment." />{general}<div className="lp-section-break"><SectionHeading title="API access" description="Connect your applications to Studio." />{api}</div></section><section><SectionHeading title="Model gateway" description="The model used to extract your documents." />{modelForm}</section></div><section className="lp-people-wide">{people}</section></>;
}

