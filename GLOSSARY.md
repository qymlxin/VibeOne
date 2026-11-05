# VibeOne

VibeOne connects coding agents to a shared desktop and phone workbench. These terms describe the user's work and its control across devices.

## Work and execution

**Workspace**:
An authorized project directory in which an agent works. A workspace may contain several conversations.
_Avoid_: Project when referring specifically to an authorized execution directory.

**Agent Provider**:
A supported way of connecting a coding tool to VibeOne, including the capabilities that connection offers.
_Avoid_: Model provider, plugin when referring to the coding tool connection itself.

**Agent Profile**:
A named configuration of an Agent Provider selected for a conversation.
_Avoid_: Agent account, model when referring to the complete configuration.

**Session**:
A conversation bound to one Workspace and one Agent Profile. A Session contains successive Runs and their conversation history.
_Avoid_: Task, Run, process when referring to the conversation.

**Run**:
One execution attempt triggered by an accepted user message in a Session. A Run may produce multiple messages, Tool Calls, and Approval Requests.
_Avoid_: Session, tool invocation, successful change when referring to one execution attempt.

**Queued Message**:
An accepted message waiting for the current Run to finish before it can start another Run in the same Session.
_Avoid_: Draft, running task.

**Draft**:
Input being edited on a device that has not been accepted for execution or queueing.
_Avoid_: Queued Message, sent message.

**Tool Call**:
An action reported by an agent during a Run, such as reading a file or running a command.
_Avoid_: Run, Approval Request.

## Human decisions

**Approval Request**:
An agent's request for a human decision about a specific action using the choices the agent offers.
_Avoid_: General question, automatic authorization.

**Approval Decision**:
The single accepted choice for an Approval Request. A recorded decision and the resulting tool execution are separate facts.
_Avoid_: Tool success, completed Run.

**Input Request**:
An agent's request for an answer or clarification, distinct from permission to perform an action.
_Avoid_: Approval Request when no action authorization is involved.

**Attention Item**:
An unresolved Approval Request or Input Request requiring user action.
_Avoid_: Error, running state when referring to a request for human input.

## Devices and results

**Host**:
The execution authority that owns agent connections and work state on one computer.
_Avoid_: Desktop window, client device.

**Device**:
A desktop or phone authorized to observe or control work through a Host.
_Avoid_: Host when referring to a viewing or controlling endpoint.

**Workspace Change**:
A difference currently observed in the Workspace. It may include edits made by the user or other tools, not only the current Run.
_Avoid_: Agent change without evidence of authorship.

**Artifact**:
A recorded output associated with work, such as a log, attachment, or change snapshot.
_Avoid_: Workspace file when referring to a recorded result rather than the current file.

**Plugin Contribution**:
A named capability supplied through a supported extension point, such as an Agent Provider, notification channel, or settings panel.
_Avoid_: Arbitrary application override.

**Plugin Package**:
A versioned installable bundle declaring Plugin Contributions and any required executable or display resources.
_Avoid_: Plugin Instance when referring to the installed bundle.

**App Plugin**:
The client-facing part of a Plugin Package that supplies workbench interface and interaction contributions.
_Avoid_: Plugin Worker when referring to client-side behavior.

**Plugin Worker**:
The Host-side execution part of a Plugin Package that handles background plugin operations.
_Avoid_: Agent when referring to plugin background execution.

**Plugin Instance**:
An activated Plugin Package within a specific user, Workspace, or Session scope.
_Avoid_: Installed version when referring to an active instance.

**Plugin Generation**:
A distinct activated revision of a Plugin Instance that existing consumers can retain while a replacement is prepared.
_Avoid_: Package version when referring to the identity of an activation.

**Provider Lease**:
A Session's claim on the particular Agent Provider generation it uses until that claim is explicitly released or migrated.
_Avoid_: Per-Run version selection when referring to a continuing Session.
