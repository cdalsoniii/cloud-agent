/**
 * assistant-ui Happy Path Specification — Quint Executable Spec
 *
 * Models the core state machine of the assistant-ui React chat UI library.
 * Covers every major happy path:
 *   - Thread CRUD (create, switch, archive)
 *   - Composer (type, attach files, remove attachments)
 *   - Message lifecycle (send, stream, complete)
 *   - Tool calls & results
 *   - Human-in-the-loop approvals
 *   - Message editing & branching
 *   - Slash commands & suggestions
 *   - Error handling & retry
 *
 * Run with:
 *   quint run assistant-ui-happy-paths.qnt --invariant=no_orphan_tool_results
 *
 * NOTE: Quint lists do NOT support .filter, .exists, .forall, or .map.
 * This spec uses .foldl exclusively for all list processing.
 *
 * @module assistant_ui
 */
module assistant_ui {

  // ---------------------------------------------------------------------------
  // 1. Domain Types
  // ---------------------------------------------------------------------------

  type ContentPart =
    | TextPart(str)
    | ToolCallPart({ toolId: str, toolName: str, args: str })
    | ToolResultPart({ toolId: str, result: str })
    | AttachmentPart({ fileName: str, fileType: str })
    | ReasoningPart(str)

  type Role =
    | UserRole
    | AssistantRole
    | SystemRole
    | ToolRole

  type MessageStatus =
    | ComposingStatus
    | PendingStatus
    | StreamingStatus
    | PausedStatus
    | CompletedStatus
    | ErroredStatus

  type Message = {
    id: str,
    role: Role,
    parts: List[ContentPart],
    status: MessageStatus,
    branchIndex: int,
    parentId: str
  }

  type ThreadStatus =
    | ThreadIdle
    | ThreadRunning
    | ThreadPaused

  type Thread = {
    id: str,
    title: str,
    isArchived: bool,
    messages: List[str],
    status: ThreadStatus
  }

  type ApprovalRequest = {
    toolId: str,
    toolName: str,
    args: str,
    parentMessageId: str
  }

  // ---------------------------------------------------------------------------
  // 2. State Variables
  // ---------------------------------------------------------------------------

  var threads: List[Thread]
  var messages: List[Message]
  var activeThreadId: str
  var approvalQueue: List[ApprovalRequest]
  var composerState: str
  var composerAttachments: List[str]

  // ---------------------------------------------------------------------------
  // 3. Pure Helpers
  // ---------------------------------------------------------------------------

  pure val MAX_THREADS = 100
  pure val MAX_MESSAGES_PER_THREAD = 1000
  pure val MAX_ATTACHMENTS = 5

  pure def nonEmpty(s: str): bool = s != ""

  /// Count tool call parts via foldl
  pure def countToolCalls(parts: List[ContentPart]): int =
    parts.foldl(0, (cnt, p) =>
      match p { | ToolCallPart(_) => cnt + 1 | _ => cnt })

  /// Count tool result parts via foldl
  pure def countToolResults(parts: List[ContentPart]): int =
    parts.foldl(0, (cnt, p) =>
      match p { | ToolResultPart(_) => cnt + 1 | _ => cnt })

  /// Get tool call IDs via foldl
  pure def callIds(parts: List[ContentPart]): List[str] =
    parts.foldl(List(), (acc, p) =>
      match p { | ToolCallPart(tc) => acc.append(tc.toolId) | _ => acc })

  /// Get tool result IDs via foldl
  pure def resultIds(parts: List[ContentPart]): List[str] =
    parts.foldl(List(), (acc, p) =>
      match p { | ToolResultPart(tr) => acc.append(tr.toolId) | _ => acc })

  /// Get text strings via foldl
  pure def getTexts(parts: List[ContentPart]): List[str] =
    parts.foldl(List(), (acc, p) =>
      match p { | TextPart(t) => acc.append(t) | _ => acc })

  /// List membership via foldl
  pure def lstHas(lst: List[str], v: str): bool =
    lst.foldl(false, (found, x) => found or x == v)

  // ---------------------------------------------------------------------------
  // 4. State Access (all foldl)
  // ---------------------------------------------------------------------------

  val EMPTY_THREAD: Thread =
    { id: "", title: "", isArchived: false, messages: List(), status: ThreadIdle }

  val EMPTY_MSG: Message =
    { id: "", role: AssistantRole, parts: List(), status: CompletedStatus, branchIndex: 0, parentId: "" }

  val activeThread =
    threads.foldl(EMPTY_THREAD, (acc, t) =>
      if (t.id == activeThreadId) t else acc)

  val activeMessages =
    messages.foldl(List(), (acc, m) =>
      if (lstHas(activeThread.messages, m.id)) acc.append(m) else acc)

  val lastMessageId =
    if (activeThread.messages.length() > 0)
      activeThread.messages[activeThread.messages.length() - 1]
    else ""

  val lastMessage =
    messages.foldl(EMPTY_MSG, (acc, m) =>
      if (m.id == lastMessageId) m else acc)

  val threadIsQuiescent =
    activeMessages.foldl(true, (ok, m) =>
      ok and (m.status == CompletedStatus or m.status == ErroredStatus))

  val threadCount = threads.length()

  // ---------------------------------------------------------------------------
  // 5. Actions
  // ---------------------------------------------------------------------------

  // --- Bootstrap ---

  action init = all {
    threads' = List({
      id: "thread-0", title: "New Chat", isArchived: false,
      messages: List(), status: ThreadIdle
    }),
    messages' = List(),
    activeThreadId' = "thread-0",
    approvalQueue' = List(),
    composerState' = "",
    composerAttachments' = List()
  }

  // --- Thread Management ---

  action createThread = {
    nondet newId = Set("thread-1", "thread-2", "thread-3", "thread-4", "thread-5").oneOf()
    val idTaken = threads.foldl(false, (ok, t) => ok or t.id == newId)
    all {
      threadCount < MAX_THREADS,
      idTaken == false,
      threadIsQuiescent,
      threads' = threads.append({
        id: newId, title: "New Chat", isArchived: false,
        messages: List(), status: ThreadIdle
      }),
      activeThreadId' = newId,
      composerState' = "",
      composerAttachments' = List(),
      messages' = messages,
      approvalQueue' = approvalQueue
    }
  }

    action switchThread = {
      val candidateIds = threads.foldl(Set(), (acc, t) =>
        if (t.isArchived == false and t.id != activeThreadId) acc.union(Set(t.id)) else acc)
      nondet targetId = candidateIds.oneOf()
      all {
        threadIsQuiescent,
        candidateIds.size() > 0,
        activeThreadId' = targetId,
        composerState' = "",
        composerAttachments' = List(),
        threads' = threads,
        messages' = messages,
        approvalQueue' = approvalQueue
      }
    }

    action archiveThread = {
      val candidateIds = threads.foldl(Set(), (acc, t) =>
        if (t.isArchived == false and t.id != activeThreadId) acc.union(Set(t.id)) else acc)
      nondet nxtId = candidateIds.oneOf()
      all {
        threadIsQuiescent,
        activeThread.isArchived == false,
        candidateIds.size() > 0,
        threads' = threads.foldl(List(), (acc, t) =>
          acc.append(if (t.id == activeThreadId) t.with("isArchived", true) else t)),
        activeThreadId' = nxtId,
        composerState' = "",
        composerAttachments' = List(),
        messages' = messages,
        approvalQueue' = approvalQueue
      }
    }

  // --- Composer ---

  action typeComposer = {
    nondet typed = Set("hello", "how are you", "tell me a joke", "explain quantum physics").oneOf()
    all {
      activeThread.status == ThreadIdle,
      composerState' = typed,
      threads' = threads,
      messages' = messages,
      activeThreadId' = activeThreadId,
      approvalQueue' = approvalQueue,
      composerAttachments' = composerAttachments
    }
  }

  action attachFile = {
    nondet fn = Set("doc.pdf", "img.png", "code.ts").oneOf()
    all {
      activeThread.status == ThreadIdle,
      composerAttachments.length() < MAX_ATTACHMENTS,
      composerAttachments' = composerAttachments.append(fn),
      threads' = threads,
      messages' = messages,
      activeThreadId' = activeThreadId,
      approvalQueue' = approvalQueue,
      composerState' = composerState
    }
  }

  action removeAttachment = all {
    activeThread.status == ThreadIdle,
    composerAttachments.length() > 0,
    composerAttachments' =
      if (composerAttachments.length() <= 1) List()
      else composerAttachments.slice(1, composerAttachments.length()),
    threads' = threads,
    messages' = messages,
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState
  }

  // --- Message Send & Stream ---

  action sendMessage = all {
    activeThread.status == ThreadIdle,
    nonEmpty(composerState),
    activeThread.messages.length() < MAX_MESSAGES_PER_THREAD,
    messages' = messages.append({
      id: "usr",
      role: UserRole,
      parts: List(TextPart(composerState)),
      status: CompletedStatus,
      branchIndex: 0,
      parentId: if (activeThread.messages.length() > 0)
        activeThread.messages[activeThread.messages.length() - 1] else ""
    }),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(
        if (t.id == activeThreadId)
          t.with("messages", t.messages.append("usr")).with("status", ThreadRunning)
        else t
      )),
    activeThreadId' = activeThreadId,
    composerState' = "",
    composerAttachments' = List(),
    approvalQueue' = approvalQueue
  }

  action beginAssistantResponse = all {
    activeThread.status == ThreadRunning,
    messages' = messages.append({
      id: "ast",
      role: AssistantRole,
      parts: List(TextPart("How can I help you?")),
      status: StreamingStatus,
      branchIndex: 0,
      parentId: if (activeThread.messages.length() > 0)
        activeThread.messages[activeThread.messages.length() - 1] else ""
    }),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(
        if (t.id == activeThreadId) t.with("messages", t.messages.append("ast")) else t
      )),
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  action completeAssistantMessage = all {
    activeThread.status == ThreadRunning,
    lastMessage.role == AssistantRole,
    lastMessage.status == StreamingStatus,
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(if (m.id == "ast") m.with("status", CompletedStatus) else m)),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadIdle) else t)),
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  // --- Tool Calls ---

  action requestToolCall = all {
    activeThread.status == ThreadRunning,
    lastMessage.role == AssistantRole,
    lastMessage.status == StreamingStatus,
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(
        if (m.id == "ast")
          m.with("parts", m.parts.append(ToolCallPart({
            toolId: "t1", toolName: "search", args: "{}" })))
        else m
      )),
    threads' = threads,
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  action completeToolCall = all {
    activeThread.status == ThreadRunning,
    lastMessage.role == AssistantRole,
    lastMessage.status == StreamingStatus,
    countToolCalls(lastMessage.parts) > countToolResults(lastMessage.parts),
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(
        if (m.id == "ast")
          m.with("parts", m.parts.append(ToolResultPart({
            toolId: "t1", result: "done" })))
        else m
      )),
    threads' = threads,
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  // --- Human Approval ---

  action requestHumanApproval = all {
    activeThread.status == ThreadRunning,
    lastMessage.role == AssistantRole,
    lastMessage.status == StreamingStatus,
    approvalQueue' = approvalQueue.append({
      toolId: "t1", toolName: "send_email", args: "{}", parentMessageId: "ast"
    }),
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(if (m.id == "ast") m.with("status", PausedStatus) else m)),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadPaused) else t)),
    activeThreadId' = activeThreadId,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  action approveTool = all {
    activeThread.status == ThreadPaused,
    approvalQueue.length() > 0,
    approvalQueue' = approvalQueue.tail(),
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(if (m.id == "ast") m.with("status", StreamingStatus) else m)),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadRunning) else t)),
    activeThreadId' = activeThreadId,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  // --- Message Editing ---

  action beginEditMessage = all {
    threadIsQuiescent,
    activeThread.status == ThreadIdle,
    composerState' = "edited text",
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(
        if (m.role == UserRole and m.status == CompletedStatus)
          m.with("status", ComposingStatus)
        else m
      )),
    threads' = threads,
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerAttachments' = composerAttachments
  }

  action submitEdit = all {
    activeThread.status == ThreadIdle,
    nonEmpty(composerState),
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(
        if (m.status == ComposingStatus)
          m.with("status", CompletedStatus)
           .with("parts", List(TextPart(composerState)))
           .with("branchIndex", m.branchIndex + 1)
        else m
      )),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadRunning) else t)),
    activeThreadId' = activeThreadId,
    composerState' = "",
    composerAttachments' = List(),
    approvalQueue' = approvalQueue
  }

  // --- Branching ---

  action regenerateMessage = all {
    activeThread.status == ThreadIdle,
    threadIsQuiescent,
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(
        if (m.id == "ast") m.with("branchIndex", m.branchIndex + 1) else m)),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadRunning) else t)),
    activeThreadId' = activeThreadId,
    approvalQueue' = List(),
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  action navigateBranch = all {
    threadIsQuiescent,
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(
        if (m.id == "ast" and m.branchIndex > 0)
          m.with("branchIndex", m.branchIndex - 1)
        else m)),
    threads' = threads,
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  // --- Slash Commands & Suggestions ---

  action slashCommand = {
    nondet cmd = Set("/search", "/image", "/clear", "/help").oneOf()
    all {
      threadIsQuiescent,
      composerState' = cmd,
      threads' = threads,
      messages' = messages,
      activeThreadId' = activeThreadId,
      approvalQueue' = approvalQueue,
      composerAttachments' = composerAttachments
    }
  }

  action clickSuggestion = {
    nondet sug = Set("What can you help with?", "Tell me a fun fact").oneOf()
    all {
      threadIsQuiescent,
      composerState' = sug,
      composerAttachments' = composerAttachments,
      threads' = threads,
      messages' = messages,
      activeThreadId' = activeThreadId,
      approvalQueue' = approvalQueue
    }
  }

  // --- Error & Recovery ---

  action messageError = all {
    activeThread.status == ThreadRunning,
    lastMessage.role == AssistantRole,
    lastMessage.status == StreamingStatus,
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(if (m.id == "ast") m.with("status", ErroredStatus) else m)),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadIdle) else t)),
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  action retryAfterError = all {
    activeThread.status == ThreadIdle,
    lastMessage.status == ErroredStatus,
    messages' = messages.foldl(List(), (acc, m) =>
      acc.append(if (m.id == "ast") m.with("status", StreamingStatus) else m)),
    threads' = threads.foldl(List(), (acc, t) =>
      acc.append(if (t.id == activeThreadId) t.with("status", ThreadRunning) else t)),
    activeThreadId' = activeThreadId,
    approvalQueue' = approvalQueue,
    composerState' = composerState,
    composerAttachments' = composerAttachments
  }

  // ---------------------------------------------------------------------------
  // 6. Invariants
  // ---------------------------------------------------------------------------

  val no_orphan_tool_results =
    messages.foldl(true, (ok, m) =>
      ok and {
        val cids = callIds(m.parts)
        val rids = resultIds(m.parts)
        rids.foldl(true, (inner, rid) => inner and lstHas(cids, rid))
      })

  val approvals_have_paused =
    approvalQueue.length() == 0 or activeThread.status == ThreadPaused

  val thread_count_bounded =
    threads.length() <= MAX_THREADS

  val running_implies_streaming =
    if (activeThread.status == ThreadRunning)
      activeMessages.foldl(false, (found, m) =>
        found or m.status == StreamingStatus or m.status == PausedStatus)
    else true

  // ---------------------------------------------------------------------------
  // 7. Example Runs — Documented Happy Paths
  // ---------------------------------------------------------------------------

  run sendAndReceiveTest =
    init.then(typeComposer).then(sendMessage)
        .then(beginAssistantResponse).then(completeAssistantMessage)

  run toolCallTest =
    init.then(typeComposer).then(sendMessage)
        .then(beginAssistantResponse).then(requestToolCall)
        .then(completeToolCall).then(completeAssistantMessage)

  run humanApprovalTest =
    init.then(typeComposer).then(sendMessage)
        .then(beginAssistantResponse).then(requestHumanApproval)
        .then(approveTool).then(completeAssistantMessage)

  run editAndResubmitTest =
    init.then(typeComposer).then(sendMessage)
        .then(beginAssistantResponse).then(completeAssistantMessage)
        .then(beginEditMessage).then(submitEdit)
        .then(sendMessage).then(beginAssistantResponse)
        .then(completeAssistantMessage)

  run errorRecoveryTest =
    init.then(typeComposer).then(sendMessage)
        .then(beginAssistantResponse).then(messageError)
        .then(retryAfterError).then(completeAssistantMessage)
}
